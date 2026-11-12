/**
 * Send execution loop — shared by immediate sends (/api/send, streamed) and the scheduler (no client).
 *
 * Works off the persisted record: every recipient still "pending" is attempted in order.
 * Recipients already "skipped" (over limit, removed, suppressed before start) are left alone.
 * Progress is written to the record after each recipient, so the result survives a client disconnect.
 */
import { Resend } from "resend";
import { getSend, updateSend, invalidateResendIdIndex, type SendRecord } from "./send-log";
import { SEND_MIN_GAP_MS } from "./config";
import { isSuppressed } from "./suppression";
import { unsubscribeUrl, unsubscribeMailto } from "./unsubscribe";
import { globalThrottle } from "./send-guards";
import { fillPlaceholders, fillSubject } from "./personalize";
import { SKIP_REASON } from "./status-text";
import { inlineLocalImages, type InlineImageAttachment } from "./email-images";
import { brand } from "@/brand.config";

const MAX_RETRIES = 1;
const RETRY_BASE_MS = 1000;

export type SendEvent =
  | { type: "ok"; to: string; id?: string; i: number; total: number }
  | { type: "fail"; to: string; error: string; i: number; total: number }
  | { type: "skip"; to: string; reason: string; i: number; total: number }
  | { type: "done"; sendId: string; ok: number; fail: number; skipped: number; aborted: boolean; total: number; failedEmails: string[]; at: string };

export type RunInput = {
  sendId: string;
  /** Full, token-preserving html (unsubscribe footer already ensured for ad mails). */
  html: string;
  /** Final subject (with "(광고)" prefix when applicable), may contain personalization tokens. */
  subject: string;
  from: string;
  replyTo: string;
  isAd: boolean;
  isTest: boolean;
  /** Body contains %%UNSUB_URL%%. */
  hasUnsub: boolean;
  emit?: (ev: SendEvent) => void;
};

function markRecipient(sendId: string, email: string, patch: Partial<SendRecord["recipients"][number]>, counter: "sent" | "failed" | "skipped") {
  return updateSend(sendId, (r) => ({
    ...r,
    recipients: r.recipients.map((x) => (x.email === email ? { ...x, ...patch } : x)),
    summary: { ...r.summary, [counter]: ((r.summary as any)[counter] ?? 0) + 1 },
  })).catch(() => null);
}

export async function executeSend(input: RunInput): Promise<SendRecord | null> {
  const { sendId, subject, from, replyTo, isAd, isTest, hasUnsub, emit } = input;
  // Image delivery (brand.config assets.delivery): "attach" turns local images into CID inline
  // attachments once per send (recipient-independent); "hosted" sends image URLs as they are.
  let html = input.html;
  let attachments: InlineImageAttachment[] | undefined;
  if (brand.assets.delivery === "attach") {
    const inlined = await inlineLocalImages(html);
    html = inlined.html;
    attachments = inlined.attachments.length ? inlined.attachments : undefined;
  }
  const key = process.env.RESEND_EMAIL_TRACKING_API_KEY;
  const resend = key ? new Resend(key) : null;
  const mailtoUnsub = unsubscribeMailto();

  const start = await getSend(sendId);
  if (!start) return null;
  const queue = start.recipients.filter((r) => r.status === "pending");
  const total = start.recipients.length;
  let ok = 0, fail = 0, skipped = start.recipients.filter((r) => r.status === "skipped").length, aborted = false;
  let i = total - queue.length;

  for (const rec of queue) {
    i++;
    if (!isTest) {
      const cur = await getSend(sendId).catch(() => null);
      if (cur?.abortRequested) { aborted = true; break; }
      // Removed from a scheduled send while it was running.
      const still = cur?.recipients.find((x) => x.email === rec.email);
      if (still && still.status !== "pending") continue;
    }
    await globalThrottle(SEND_MIN_GAP_MS);
    const to = rec.email;

    // Unsubscribed/bounced while this send was in progress → skip (not a failure; not a re-send target).
    if (!isTest && (await isSuppressed(to))) {
      skipped++;
      await markRecipient(sendId, to, { status: "skipped", error: SKIP_REASON.suppressed }, "skipped");
      emit?.({ type: "skip", to, reason: SKIP_REASON.suppressed, i, total });
      continue;
    }

    const includeUnsubHeader = !isTest && (hasUnsub || isAd);
    const unsubUrl = includeUnsubHeader ? unsubscribeUrl(to, sendId) : "#";
    const body = fillPlaceholders(html, {
      name: rec.name, email: to, company: rec.company, title: rec.title,
      unsubscribeUrl: hasUnsub && !isTest ? unsubUrl : "#",
    });
    const recipientSubject = fillSubject(subject, { name: rec.name, email: to, company: rec.company, title: rec.title });
    const headers = includeUnsubHeader
      ? { "List-Unsubscribe": `<${unsubUrl}>, <${mailtoUnsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined;

    let attempt = 0, success = false, lastErr = "", resendId: string | undefined;
    if (!resend) lastErr = "RESEND_EMAIL_TRACKING_API_KEY 없음";
    while (resend && attempt <= MAX_RETRIES && !success) {
      try {
        const { data, error } = await resend.emails.send({
          from, to, ...(replyTo ? { replyTo } : {}), subject: recipientSubject, html: body, headers,
          ...(attachments ? { attachments } : {}),
        });
        if (error) {
          lastErr = error.message ?? String(error);
          const code = (error as any).statusCode ?? (error as any).status;
          if (attempt < MAX_RETRIES && (code === 429 || (typeof code === "number" && code >= 500 && code < 600))) {
            attempt++;
            await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
            continue;
          }
          break;
        }
        success = true;
        resendId = data?.id;
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

    if (success) {
      ok++;
      await markRecipient(sendId, to, { status: "sent", resendId, sentAt: new Date().toISOString() }, "sent");
      emit?.({ type: "ok", to, id: resendId, i, total });
    } else {
      fail++;
      await markRecipient(sendId, to, { status: "failed", error: lastErr }, "failed");
      emit?.({ type: "fail", to, error: lastErr, i, total });
    }
  }

  invalidateResendIdIndex();
  const final = await updateSend(sendId, (r) => ({
    ...r,
    status: aborted ? "aborted" : "completed",
    finishedAt: new Date().toISOString(),
    // Frozen content is only needed until execution.
    snapshot: undefined,
  })).catch(() => null);

  emit?.({
    type: "done", sendId, ok, fail, skipped, aborted, total,
    failedEmails: final ? final.recipients.filter((r) => r.status === "failed").map((r) => r.email) : [],
    at: new Date().toISOString(),
  });
  return final;
}
