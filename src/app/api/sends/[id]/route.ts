import { NextRequest, NextResponse } from "next/server";
import { getSend, buildResendIdIndex, updateSend, requestAbort, computeMetrics } from "@/lib/send-log";
import { requireUserEmail } from "@/lib/auth";
import { canManageAsync } from "@/lib/admins";

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
 * - ?withStatus=1 : query Resend for each resendId's status, merge it, and persist to the record (guards against live status being lost after 30 days).
 * - ?format=csv   : download per-recipient status as CSV.
 * PATCH { abort: true } : request to stop an in-progress send.
 */
const STATUS_CACHE = new Map<string, { at: number; status: string }>();
const CACHE_TTL_MS = 5_000;
const FETCH_CONCURRENCY = 6; // Protect Resend rate-limit (~10/sec): concurrent query cap

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
  // Cache both success and failure (including unknown) — so the next poll doesn't immediately stampede again on 429/errors.
  STATUS_CACHE.set(resendId, { at: Date.now(), status: s });
  return s;
}

/** Concurrency-limited map — keeps the N+1 fetch from hitting Resend all at once. */
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

  // Persist live status to the record (guards against Resend's 30-day retention limit). unknown is not stored.
  const at = new Date().toISOString();
  const persisted = await updateSend(params.id, (r) => ({
    ...r,
    recipients: r.recipients.map((x) =>
      x.resendId && statusMap.has(x.resendId) && statusMap.get(x.resendId) !== "unknown"
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
  if (!body?.abort) return NextResponse.json({ error: "지원하지 않는 작업" }, { status: 400 });

  // Permission: only the sender themselves or an admin can abort (IDOR prevention — block aborting someone else's send).
  const rec = await getSend(params.id);
  if (!rec) return NextResponse.json({ error: "발송 기록 없음" }, { status: 404 });
  if (!(await canManageAsync(rec.sentBy, actor))) {
    return NextResponse.json({ error: "본인 또는 관리자만 발송을 중단할 수 있습니다" }, { status: 403 });
  }

  const r = await requestAbort(params.id);
  if (!r) return NextResponse.json({ error: "중단할 수 없습니다 (이미 종료됨)" }, { status: 400 });
  return NextResponse.json({ ok: true, status: r.status, abortRequested: r.abortRequested });
}
