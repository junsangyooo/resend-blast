import { NextRequest, NextResponse } from "next/server";
import { getSend, buildResendIdIndex, updateSend, requestAbort, computeMetrics, shouldApplyLiveStatus } from "@/lib/send-log";
import { requireUserEmail } from "@/lib/auth";
import { canManageAsync } from "@/lib/admins";
import { cancelSchedule, rescheduleSend, removeScheduledRecipient, refreshScheduledList, refreshScheduledContent } from "@/lib/schedule-ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendEmail = {
  id: string;
  to: string[] | string;
  subject: string;
  last_event?: string;
  status?: string;
  created_at: string;
};

/**
 * Single send detail.
 * - ?withStatus=1 : query Resend for each resendId status, merge, and persist to the record (guards against live status being lost after 30 days).
 * - ?format=csv   : download per-recipient status as CSV.
 * PATCH { abort: true } : request to abort an in-progress send.
 */
const STATUS_CACHE = new Map<string, { at: number; status: string }>();
const CACHE_TTL_MS = 5_000;
const FETCH_CONCURRENCY = 6; // Protect the Resend rate limit (~10/sec): cap on concurrent lookups

async function fetchStatus(key: string, resendId: string): Promise<string> {
  const c = STATUS_CACHE.get(resendId);
  if (c && Date.now() - c.at < CACHE_TTL_MS) return c.status;
  let s = "unknown";
  try {
    const r = await fetch(`https://api.resend.com/emails/${resendId}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json()) as ResendEmail;
      s = (j.last_event ?? j.status ?? "unknown").toLowerCase();
    }
  } catch {
    s = "unknown";
  }
  // Cache both successes and failures (including unknown) — so the next poll doesn't immediately flood again after a 429/error.
  STATUS_CACHE.set(resendId, { at: Date.now(), status: s });
  return s;
}

/** Concurrency-limited map — keeps the N+1 fetch from hammering Resend all at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const send = await getSend(params.id);
  if (!send) return NextResponse.json({ error: "발송 기록 없음" }, { status: 404 });

  const format = req.nextUrl.searchParams.get("format");
  if (format === "csv") {
    const header = ["email", "name", "list", "status", "liveStatus", "error", "sentAt"];
    const rows = send.recipients.map((r) =>
      [r.email, r.name ?? "", r.listSlug ?? "", r.status, r.liveStatus ?? "", r.error ?? "", r.sentAt ?? ""].map(csvCell).join(",")
    );
    const csv = "﻿" + [header.join(","), ...rows].join("\n"); // BOM for Excel (Korean)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="send-${params.id}.csv"`,
      },
    });
  }

  const withStatus = req.nextUrl.searchParams.get("withStatus") === "1";
  if (!withStatus) {
    return NextResponse.json({ send, metrics: computeMetrics(send) });
  }

  const key = process.env.RESEND_EMAIL_TRACKING_API_KEY;
  if (!key) return NextResponse.json({ send, metrics: computeMetrics(send), error: "tracking key 없음" });

  const idx = await buildResendIdIndex();
  const ids = send.recipients
    .filter((r) => r.resendId && idx.has(r.resendId))
    .map((r) => r.resendId!);
  const results = await mapLimit(ids, FETCH_CONCURRENCY, (id) =>
    fetchStatus(key, id).then((status) => ({ id, status }))
  );
  const statusMap = new Map(results.map((r) => [r.id, r.status]));

  // Persist live status to the record (Resend only retains 30 days). unknown is not saved.
  const at = new Date().toISOString();
  const persisted = await updateSend(params.id, (r) => ({
    ...r,
    recipients: r.recipients.map((x) =>
      x.resendId && statusMap.has(x.resendId) && statusMap.get(x.resendId) !== "unknown"
        && shouldApplyLiveStatus(x.liveStatus, statusMap.get(x.resendId)!)
        ? { ...x, liveStatus: statusMap.get(x.resendId), liveStatusAt: at }
        : x
    ),
  })).catch(() => null);

  const out = persisted ?? {
    ...send,
    recipients: send.recipients.map((r) =>
      r.resendId && statusMap.has(r.resendId) ? { ...r, liveStatus: statusMap.get(r.resendId) } : r
    ),
  };
  return NextResponse.json({ send: out, metrics: computeMetrics(out) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let actor: string;
  try {
    actor = await requireUserEmail();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // Permission: only the sender themselves or an admin (prevents IDOR — blocks tampering with others' sends/schedules).
  const rec = await getSend(params.id);
  if (!rec) return NextResponse.json({ error: "발송 기록 없음" }, { status: 404 });
  if (!(await canManageAsync(rec.sentBy, actor))) {
    return NextResponse.json({ error: "보낸 사람 또는 관리자만 할 수 있습니다" }, { status: 403 });
  }

  try {
    if (body?.abort) {
      const r = await requestAbort(params.id);
      if (!r) return NextResponse.json({ error: "중단할 수 없습니다 (이미 종료됨)" }, { status: 400 });
      return NextResponse.json({ ok: true, status: r.status, abortRequested: r.abortRequested });
    }
    if (body?.cancel) return NextResponse.json({ ok: true, send: await cancelSchedule(params.id, actor) });
    if (typeof body?.scheduledAt === "string") return NextResponse.json({ ok: true, send: await rescheduleSend(params.id, body.scheduledAt) });
    if (typeof body?.removeRecipient === "string") return NextResponse.json({ ok: true, send: await removeScheduledRecipient(params.id, body.removeRecipient) });
    if (typeof body?.refreshList === "string") return NextResponse.json({ ok: true, ...(await refreshScheduledList(params.id, body.refreshList)) });
    if (body?.refreshContent) return NextResponse.json({ ok: true, send: await refreshScheduledContent(params.id) });
    if (body?.acknowledge) {
      const r = await updateSend(params.id, (x) => ({ ...x, problemAcknowledged: true }));
      return NextResponse.json({ ok: true, send: r });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "실패" }, { status: 400 });
  }
  return NextResponse.json({ error: "지원하지 않는 작업" }, { status: 400 });
}
