import { NextRequest } from "next/server";
import { buildFullHtml } from "@/lib/templates";
import { parseRecipientGrid, dedupeRecipients, type Recipient } from "@/lib/recipients";
import { resolveListMembersWithOrigin } from "@/lib/lists";
import { createSend, newSendId, userSendVolume, findRecentSendByHash, type SendRecord, type SendRecipient } from "@/lib/send-log";
import { FROM_DEFAULT, resolveReplyTo, isFromAllowed, MAX_RECIPIENTS_PER_SEND, USER_DAILY_SEND_LIMIT, USER_HOURLY_SEND_LIMIT } from "@/lib/config";
import { isSenderAllowedFor } from "@/lib/senders";
import { requireUserEmail } from "@/lib/auth";
import { suppressedSet } from "@/lib/suppression";
import { contentHash, contentFingerprint } from "@/lib/send-guards";
import { ensureUnsubFooter, hasUnsubLink } from "@/lib/unsub-footer";
import { executeSend } from "@/lib/send-runner";
import { validateScheduleTime, parseZonedInstant } from "@/lib/schedule-rules";
import { formatKst } from "@/lib/kst";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEDUPE_WINDOW_MS = 90_000; // re-sending identical content within 90s is blocked as a duplicate (double-click/retry)

type SendBody = {
  template: string;
  listSlugs?: string[];
  /** Lists whose members are removed from this send. */
  excludeListSlugs?: string[];
  adhoc?: string;
  /** Individual addresses removed by the sender (e.g. "already received" → exclude). */
  excludeEmails?: string[];
  from?: string;
  replyTo?: string;
  isAd?: boolean;
  /** Test send for self-review: one message, only to the currently logged-in user. */
  testToSelf?: boolean;
  /** Re-send / reminder started from a past send (recorded as kind "followup"). */
  followupOf?: string;
  /** Ignore the idempotency duplicate block and force the send. */
  force?: boolean;
  /** Schedule instead of sending now (UTC ISO). */
  scheduledAt?: string;
  /** Recipient set shown on the confirm screen (after list exclusions). Server refuses if its own set differs. */
  expectedEmails?: string[];
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export async function POST(req: NextRequest) {
  let sentBy: string;
  try {
    sentBy = await requireUserEmail();
  } catch {
    return json({ error: "unauthenticated" }, 401);
  }

  const body = (await req.json()) as SendBody;
  const templateName = String(body.template ?? "");
  const built = await buildFullHtml(templateName);
  if (!built) return json({ error: "이메일 없음" }, 400);

  const isTest = !!body.testToSelf;
  const isAd = !!body.isAd;
  const scheduledAt = !isTest && body.scheduledAt ? parseZonedInstant(body.scheduledAt) : null;
  if (!isTest && body.scheduledAt && !scheduledAt) return json({ error: "예약 시각은 시간대가 붙은 ISO 형식이어야 합니다" }, 400);
  if (scheduledAt) {
    const err = validateScheduleTime(scheduledAt);
    if (err) return json({ error: err }, 400);
  }

  // Ad mail must carry an unsubscribe link in the body (Korean Network Act §50). If the design has none,
  // a fixed line is appended below the content — the design itself is never touched.
  const html = isAd ? ensureUnsubFooter(built.html) : built.html;
  const hasUnsub = hasUnsubLink(html);
  const subject = isAd && !/^\(광고\)/.test(built.subject) ? `(광고) ${built.subject}` : built.subject;
  const htmlHash = contentFingerprint(built.html, built.subject);

  // ── 1) Resolve recipients ──
  let merged: Recipient[];
  const memberOrigin = new Map<string, string | null>();
  let adhocParsed = { invalid: [] as string[], duplicates: [] as string[] };
  const listSlugs = isTest ? [] : strArr(body.listSlugs);
  const excludeListSlugs = isTest ? [] : strArr(body.excludeListSlugs).filter((s) => !listSlugs.includes(s));
  const excludeEmails = new Set(strArr(body.excludeEmails).map((e) => e.toLowerCase().trim()));
  let adhocCount = 0;
  let excludedByList = 0;

  if (isTest) {
    merged = [{ email: sentBy.toLowerCase() }];
    memberOrigin.set(sentBy.toLowerCase(), null);
  } else {
    const fromLists = await resolveListMembersWithOrigin(listSlugs);
    const grid = parseRecipientGrid(String(body.adhoc ?? ""));
    adhocParsed = { invalid: grid.ignored.map((g) => g.line), duplicates: grid.duplicates };
    adhocCount = grid.rows.length;
    for (const r of fromLists) memberOrigin.set(r.email.toLowerCase(), r.listSlug);
    for (const r of grid.rows) if (!memberOrigin.has(r.email.toLowerCase())) memberOrigin.set(r.email.toLowerCase(), null);
    merged = dedupeRecipients([
      ...fromLists.map((r) => ({ email: r.email, name: r.name, company: r.company, title: r.title })),
      ...grid.rows,
    ]);
    if (excludeListSlugs.length > 0) {
      const excluded = new Set((await resolveListMembersWithOrigin(excludeListSlugs)).map((r) => r.email.toLowerCase()));
      const before = merged.length;
      merged = merged.filter((r) => !excluded.has(r.email.toLowerCase()));
      excludedByList = before - merged.length;
    }
    if (excludeEmails.size > 0) merged = merged.filter((r) => !excludeEmails.has(r.email.toLowerCase()));
  }

  if (merged.length === 0) return json({ error: "유효한 수신자 없음" }, 400);

  // The confirm screen showed (and checked "already received" for) a specific set. If a list changed since
  // (anyone may add members), refuse instead of silently sending to people the sender never saw.
  if (!isTest && Array.isArray(body.expectedEmails)) {
    const expected = new Set(body.expectedEmails.map((e) => String(e).toLowerCase().trim()));
    const actual = merged.map((r) => r.email.toLowerCase());
    const added = actual.filter((e) => !expected.has(e) && !excludeEmails.has(e));
    const actualSet = new Set(actual);
    const missing = Array.from(expected).filter((e) => !actualSet.has(e) && !excludeEmails.has(e));
    if (added.length > 0 || missing.length > 0) {
      return json({
        error: `확인 이후 리스트 변경 (추가 ${added.length}명 · 제외 ${missing.length}명) · 명단 새로고침 완료 · 재확인 필요`,
        recipientsChanged: true,
      }, 409);
    }
  }

  // ── 2) Exclude the suppression list (unsubscribed/bounced/spam-reported); test sends are not filtered ──
  let excludedSuppressed = 0;
  if (!isTest) {
    const supp = await suppressedSet(merged.map((r) => r.email));
    if (supp.size > 0) {
      const before = merged.length;
      merged = merged.filter((r) => !supp.has(r.email.toLowerCase()));
      excludedSuppressed = before - merged.length;
    }
    if (merged.length === 0) return json({ error: "모든 수신자가 수신거부/반송 처리되어 발송 대상이 없습니다", excludedSuppressed }, 400);
  }

  // ── 3) Recipient count cap ──
  if (!isTest && merged.length > MAX_RECIPIENTS_PER_SEND) {
    return json({ error: `1회 발송 최대 ${MAX_RECIPIENTS_PER_SEND}명을 초과했습니다 (${merged.length}명). 리스트를 나눠 보내세요.` }, 400);
  }

  // ── 4) Validate From / reply-to: unregistered senders are rejected with no silent fallback ──
  const finalFrom = String(body.from ?? "").trim() || FROM_DEFAULT;
  if (!isFromAllowed(finalFrom)) return json({ error: "허용되지 않은 발신자 도메인입니다" }, 400);
  if (!(await isSenderAllowedFor(finalFrom, sentBy))) {
    return json({ error: "사용할 수 없는 발신자입니다. 공용 발신자 또는 본인 계정만 사용할 수 있습니다 (발신자를 다시 선택하세요)." }, 400);
  }
  const replyTo = resolveReplyTo(body.replyTo);

  // ── 5) Idempotency: block re-send/re-schedule of identical content within 90s (tests excluded) ──
  const hash = contentHash({
    sentBy, from: finalFrom, subject,
    templateName: templateName + (scheduledAt ? `@${scheduledAt.toISOString()}` : ""),
    emails: merged.map((r) => r.email),
  });
  if (!isTest && !body.force) {
    const dup = await findRecentSendByHash(hash, DEDUPE_WINDOW_MS);
    if (dup) {
      return json({ error: "90초 내 동일 발송 · 중복 차단", duplicate: true, sendId: dup.id }, 409);
    }
  }

  // ── 6) Per-user send rate limit: immediate sends only. Schedules are checked at run time and the overflow is left as '미발송'.
  if (!isTest && !scheduledAt) {
    const [hourVol, dayVol] = await Promise.all([
      userSendVolume(sentBy, 60 * 60 * 1000),
      userSendVolume(sentBy, 24 * 60 * 60 * 1000),
    ]);
    if (hourVol + merged.length > USER_HOURLY_SEND_LIMIT) {
      return json({ error: `시간당 발송 한도(${USER_HOURLY_SEND_LIMIT}명) 초과. 잠시 후 다시 시도하세요.` }, 429);
    }
    if (dayVol + merged.length > USER_DAILY_SEND_LIMIT) {
      return json({ error: `일일 발송 한도(${USER_DAILY_SEND_LIMIT}명) 초과.` }, 429);
    }
  }

  if (!process.env.RESEND_EMAIL_TRACKING_API_KEY) return json({ error: "RESEND_EMAIL_TRACKING_API_KEY 없음" }, 500);

  // ── 7) Create the send record ──
  const sendId = newSendId();
  const followupOf = !isTest && body.followupOf ? String(body.followupOf) : undefined;
  const record: SendRecord = {
    id: sendId,
    createdAt: new Date().toISOString(),
    status: scheduledAt ? "scheduled" : "running",
    sentBy,
    templateName,
    templateTitle: built.title,
    subject,
    from: finalFrom,
    replyTo,
    listSlugs,
    excludeListSlugs: excludeListSlugs.length ? excludeListSlugs : undefined,
    excludedEmails: excludeEmails.size ? Array.from(excludeEmails) : undefined,
    adhocCount,
    hash,
    htmlHash,
    isAd,
    kind: isTest ? "test" : followupOf ? "followup" : "normal",
    sourceSendId: followupOf,
    excludedSuppressed,
    ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString(), snapshot: { html, subject, hasUnsub } } : {}),
    recipients: merged.map<SendRecipient>((r) => ({
      email: r.email,
      name: r.name,
      company: r.company,
      title: r.title,
      listSlug: memberOrigin.get(r.email.toLowerCase()) ?? null,
      status: "pending",
    })),
    summary: { total: merged.length, sent: 0, failed: 0 },
  };
  await createSend(record);

  if (scheduledAt) {
    return json({
      ok: true, scheduled: true, sendId,
      scheduledAt: record.scheduledAt,
      scheduledAtKst: formatKst(scheduledAt),
      recipients: merged.length, excludedSuppressed, excludedByList,
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (obj: any) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); }
        catch { closed = true; }
      };
      send({
        type: "info",
        sendId, kind: record.kind,
        template: record.templateTitle,
        subject,
        from: finalFrom,
        valid: merged.length,
        excludedSuppressed,
        excludedByList,
        excludedManually: excludeEmails.size,
        adhoc: adhocParsed,
      });
      await executeSend({ sendId, html, subject, from: finalFrom, replyTo, isAd, isTest, hasUnsub, emit: send });
      if (!closed) { try { controller.close(); } catch {} }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
