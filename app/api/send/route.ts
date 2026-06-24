import { NextRequest } from "next/server";
import { Resend } from "resend";
import { buildFullHtml } from "@/lib/templates";
import { parseRecipientGrid, dedupeRecipients, type Recipient } from "@/lib/recipients";
import { resolveListMembersWithOrigin } from "@/lib/lists";
import {
  createSend, updateSend, getSend, newSendId,
  userSendVolume, findRecentSendByHash,
  type SendRecord, type SendRecipient,
} from "@/lib/send-log";
import { FROM_DEFAULT, resolveReplyTo, isFromAllowed, MAX_RECIPIENTS_PER_SEND, USER_DAILY_SEND_LIMIT, USER_HOURLY_SEND_LIMIT, SEND_MIN_GAP_MS } from "@/lib/config";
import { isSenderAllowedFor } from "@/lib/senders";
import { requireUserEmail } from "@/lib/auth";
import { suppressedSet, isSuppressed } from "@/lib/suppression";
import { unsubscribeUrl, unsubscribeMailto } from "@/lib/unsubscribe";
import { contentHash, globalThrottle } from "@/lib/send-guards";
import { fillPlaceholders, fillSubject, UNSUB_PLACEHOLDER } from "@/lib/personalize";
import { inlineLocalImages, type InlineImageAttachment } from "@/lib/email-images";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RETRIES = 1;
const RETRY_BASE_MS = 1000;
const DEDUPE_WINDOW_MS = 90_000; // Block re-sending identical content within 90s as a duplicate (double-click/retry)

type SendBody = {
  template: string;
  listSlugs?: string[];
  adhoc?: string;
  from?: string;
  replyTo?: string;
  isAd?: boolean;
  /** Test send for self-review — a single message to the current logged-in user only. */
  testToSelf?: boolean;
  /** Follow-up (re-send): derive targets automatically from source send id + filter. */
  sourceSendId?: string;
  followupFilter?: "failed" | "unopened";
  /** Force-send, ignoring idempotency duplicate blocking. */
  force?: boolean;
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(req: NextRequest) {
  let sentBy: string;
  try {
    sentBy = await requireUserEmail();
  } catch {
    return json({ error: "unauthenticated" }, 401);
  }

  const body = (await req.json()) as SendBody;
  const built = await buildFullHtml(String(body.template ?? ""));
  if (!built) return json({ error: "이메일 없음" }, 400);

  const isTest = !!body.testToSelf;
  const isFollowup = !isTest && !!body.sourceSendId && !!body.followupFilter;

  // Whether the template footer includes an unsubscribe link (toggle). Inject the body link/header only when present.
  // (Not enforced — inclusion is chosen by the operator at template creation time.)
  const hasUnsub = built.html.includes(UNSUB_PLACEHOLDER);

  // Advertising mail is legally required to show an unsubscribe method in the body (Network Act §50). The header alone is insufficient.
  if (!isTest && !!body.isAd && !hasUnsub) {
    return json({
      error: "광고성((광고)) 메일은 본문에 수신거부 링크가 있어야 합니다. 블록 이메일 푸터의 ‘수신거부 링크’를 켜거나, HTML 본문에 %%UNSUB_URL%% 를 포함한 뒤 다시 발송하세요.",
    }, 400);
  }

  // ── 1) Resolve recipients ──
  let merged: Recipient[];
  const memberOrigin = new Map<string, string | null>();
  let adhocParsed = { valid: [] as string[], invalid: [] as string[], duplicates: [] as string[] };
  let listSlugs: string[] = [];
  let adhocCount = 0;

  if (isTest) {
    merged = [{ email: sentBy.toLowerCase() }];
    memberOrigin.set(sentBy.toLowerCase(), null);
  } else if (isFollowup) {
    const src = await getSend(String(body.sourceSendId));
    if (!src) return json({ error: "원본 발송 기록 없음" }, 400);
    const pick = (r: SendRecipient): boolean => {
      if (body.followupFilter === "failed") return r.status === "failed";
      // Reminder: only recipients whose delivery (Delivered) is unconfirmed — opened/clicked tracking is unreliable,
      // so use delivery as the criterion instead of opens. Bounces/complaints are auto-excluded via suppression anyway.
      const ls = (r.liveStatus ?? "").toLowerCase();
      return r.status === "sent" && !["delivered", "opened", "clicked", "bounced", "complained"].includes(ls);
    };
    const chosen = src.recipients.filter(pick);
    merged = dedupeRecipients(chosen.map((r) => ({ email: r.email, name: r.name })));
    for (const r of chosen) memberOrigin.set(r.email.toLowerCase(), r.listSlug ?? null);
    listSlugs = src.listSlugs ?? [];
  } else {
    listSlugs = Array.isArray(body.listSlugs) ? body.listSlugs.filter((s) => typeof s === "string") : [];
    const fromLists = await resolveListMembersWithOrigin(listSlugs);
    // Handle ad-hoc with the grid parser — preserve name+email mapping (tab/pipe/comma/「name <email>」).
    const grid = parseRecipientGrid(String(body.adhoc ?? ""));
    const adhocItems: Recipient[] = grid.rows;
    adhocParsed = { valid: grid.rows.map((r) => r.email), invalid: grid.ignored.map((g) => g.line), duplicates: grid.duplicates };
    adhocCount = adhocItems.length;
    for (const r of fromLists) memberOrigin.set(r.email.toLowerCase(), r.listSlug);
    for (const r of adhocItems) if (!memberOrigin.has(r.email.toLowerCase())) memberOrigin.set(r.email.toLowerCase(), null);
    merged = dedupeRecipients([
      ...fromLists.map((r) => ({ email: r.email, name: r.name })),
      ...adhocItems,
    ]);
  }

  if (merged.length === 0) return json({ error: "유효한 수신자 없음" }, 400);

  // ── 2) Exclude suppression list (unsubscribe/bounce/spam complaint) — not applied to test sends ──
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

  // ── 4) From / reply-to validation — reject unregistered senders with no silent fallback ──
  // (Prevents the operational accident of sending from an unintended sender (launch@). Only an empty value uses the default sender.)
  const finalFrom = String(body.from ?? "").trim() || FROM_DEFAULT;
  if (!isFromAllowed(finalFrom)) return json({ error: "허용되지 않은 발신자 도메인입니다" }, 400);
  if (!(await isSenderAllowedFor(finalFrom, sentBy))) {
    return json({ error: "사용할 수 없는 발신자입니다. 공용 발신자 또는 본인 계정만 사용할 수 있습니다 (발신자를 다시 선택하세요)." }, 400);
  }
  const replyTo = resolveReplyTo(body.replyTo);

  // ── 5) Per-user send rate limit (excluding tests) ──
  if (!isTest) {
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

  // ── 6) Subject: prefix with (광고) if advertising ──
  const baseSubject = built.subject;
  const subject = body.isAd && !/^\(광고\)/.test(baseSubject) ? `(광고) ${baseSubject}` : baseSubject;

  // ── 7) Idempotency: block re-sending identical content within 90s (excluding tests) ──
  const hash = contentHash({ sentBy, from: finalFrom, templateName: String(body.template), subject, emails: merged.map((r) => r.email) });
  if (!isTest && !body.force) {
    const dup = await findRecentSendByHash(hash, DEDUPE_WINDOW_MS);
    if (dup) {
      return json({ error: "방금 동일한 내용을 발송했습니다. 중복 발송을 막았어요.", duplicate: true, sendId: dup.id }, 409);
    }
  }

  const sendKey = process.env.RESEND_EMAIL_TRACKING_API_KEY;
  if (!sendKey) return json({ error: "RESEND_EMAIL_TRACKING_API_KEY 없음" }, 500);
  const resend = new Resend(sendKey);

  // ── 8) Create send record (running) ──
  const sendId = newSendId();
  const record: SendRecord = {
    id: sendId,
    createdAt: new Date().toISOString(),
    status: "running",
    sentBy,
    templateName: String(body.template),
    subject,
    from: finalFrom,
    replyTo,
    listSlugs,
    adhocCount,
    hash,
    isAd: !!body.isAd,
    kind: isTest ? "test" : isFollowup ? "followup" : "normal",
    sourceSendId: isFollowup ? String(body.sourceSendId) : undefined,
    excludedSuppressed,
    recipients: merged.map<SendRecipient>((r) => ({
      email: r.email,
      name: r.name,
      listSlug: memberOrigin.get(r.email.toLowerCase()) ?? null,
      status: "pending",
    })),
    summary: { total: merged.length, sent: 0, failed: 0 },
  };
  await createSend(record);

  const mailtoUnsub = unsubscribeMailto();

  // ── Image delivery method (brand.config.assets.delivery) ──
  // "attach": convert local images in the body to CID inline attachments once → reuse for all recipients
  //           (images are recipient-independent, so base64 is read just once). No external hosting needed.
  // "hosted": use the image URLs as-is without conversion (the mail client loads them externally).
  let sendHtml = built.html;
  let inlineAttachments: InlineImageAttachment[] | undefined;
  if (brand.assets.delivery === "attach") {
    const inlined = await inlineLocalImages(built.html);
    sendHtml = inlined.html;
    inlineAttachments = inlined.attachments.length ? inlined.attachments : undefined;
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
        template: record.templateName,
        subject,
        from: finalFrom,
        valid: merged.length,
        excludedSuppressed,
        adhoc: { invalid: adhocParsed.invalid, duplicates: adhocParsed.duplicates },
      });

      let ok = 0, fail = 0, aborted = false;
      for (let i = 0; i < merged.length; i++) {
        // Check for an abort request — when the UI's 'Stop sending' button sets the record's abortRequested, exit on the next iteration.
        if (!isTest) {
          const cur = await getSend(sendId).catch(() => null);
          if (cur?.abortRequested) { aborted = true; break; }
        }

        // Global throttle: keep an interval so the Resend limit (5/sec) is not exceeded even across concurrent send streams.
        await globalThrottle(SEND_MIN_GAP_MS);

        const rec = merged[i];
        const to = rec.email;
        // Skip addresses that unsubscribed/bounced mid-send (guards against one-click unsubscribe during a long blast).
        if (!isTest && (await isSuppressed(to))) {
          fail++;
          await updateSend(sendId, (r) => ({
            ...r,
            recipients: r.recipients.map((x) => x.email === to ? { ...x, status: "failed" as const, error: "발송 중 수신거부/억제되어 제외됨" } : x),
            summary: { ...r.summary, failed: r.summary.failed + 1 },
          })).catch(() => {});
          send({ type: "fail", to, error: "발송 중 수신거부되어 제외", i: i + 1, total: merged.length });
          continue;
        }
        // Body unsubscribe link: only when the template includes it (respect the toggle).
        // List-Unsubscribe header: attach if there's a body link or it's an advertising send — without blocking the send,
        // ensure Gmail/Yahoo one-click unsubscribe (the invisible header) always works for advertising mail.
        const includeUnsubHeader = !isTest && (hasUnsub || !!body.isAd);
        const unsubUrl = includeUnsubHeader ? unsubscribeUrl(to, sendId) : "#";
        const html = fillPlaceholders(sendHtml, {
          name: rec.name,
          email: to,
          unsubscribeUrl: hasUnsub && !isTest ? unsubUrl : "#",
        });
        // The subject is also personalized per recipient (plain text — no escaping).
        const recipientSubject = fillSubject(subject, { name: rec.name, email: to });
        const headers = includeUnsubHeader ? {
          "List-Unsubscribe": `<${unsubUrl}>, <${mailtoUnsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : undefined;

        let attempt = 0, success = false, lastErr = "", resendId: string | undefined;
        while (attempt <= MAX_RETRIES && !success) {
          try {
            const { data, error } = await resend.emails.send({
              // If replyTo is empty, no header is attached → recipient replies go to the From address.
              from: finalFrom, to, ...(replyTo ? { replyTo } : {}), subject: recipientSubject, html, headers,
              ...(inlineAttachments ? { attachments: inlineAttachments } : {}),
            });
            if (error) {
              lastErr = error.message ?? String(error);
              const statusCode = (error as any).statusCode ?? (error as any).status;
              if (attempt < MAX_RETRIES && (statusCode === 429 || (typeof statusCode === "number" && statusCode >= 500 && statusCode < 600))) {
                attempt++;
                await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
                continue;
              }
              break;
            }
            success = true;
            resendId = data?.id;
            break;
          } catch (e: any) {
            lastErr = e?.message ?? String(e);
            if (attempt < MAX_RETRIES) {
              attempt++;
              await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
              continue;
            }
            break;
          }
        }

        const at = new Date().toISOString();
        if (success) {
          ok++;
          await updateSend(sendId, (r) => ({
            ...r,
            recipients: r.recipients.map((x) => x.email === to ? { ...x, status: "sent" as const, resendId, sentAt: at } : x),
            summary: { ...r.summary, sent: r.summary.sent + 1 },
          })).catch(() => {});
          send({ type: "ok", to, id: resendId, i: i + 1, total: merged.length });
        } else {
          fail++;
          await updateSend(sendId, (r) => ({
            ...r,
            recipients: r.recipients.map((x) => x.email === to ? { ...x, status: "failed" as const, error: lastErr } : x),
            summary: { ...r.summary, failed: r.summary.failed + 1 },
          })).catch(() => {});
          send({ type: "fail", to, error: lastErr, i: i + 1, total: merged.length });
        }
      }

      const finalRecord = await updateSend(sendId, (r) => ({
        ...r,
        status: aborted ? "aborted" : "completed",
        finishedAt: new Date().toISOString(),
      })).catch(() => null);

      const failedEmails = finalRecord
        ? finalRecord.recipients.filter((r) => r.status === "failed").map((r) => r.email)
        : [];

      send({ type: "done", sendId, ok, fail, aborted, total: merged.length, failedEmails, at: new Date().toISOString() });

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
