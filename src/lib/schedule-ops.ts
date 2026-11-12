/**
 * Mutations on pending scheduled sends (server-only).
 */
import { getSend, updateSend, type SendRecord } from "./send-log";
import { getList, resolveListMembersWithOrigin } from "./lists";
import { suppressedSet } from "./suppression";
import { MAX_RECIPIENTS_PER_SEND } from "./config";
import { validateScheduleTime, parseZonedInstant } from "./schedule-rules";
import { SKIP_REASON } from "./status-text";
import { buildFullHtml } from "./templates";
import { ensureUnsubFooter, hasUnsubLink } from "./unsub-footer";
import { contentFingerprint } from "./send-guards";

function assertScheduled(r: SendRecord | null): asserts r is SendRecord {
  if (!r) throw new Error("발송 기록 없음");
  if (r.status !== "scheduled") throw new Error("이미 실행됐거나 취소된 예약입니다");
}

export async function cancelSchedule(id: string, actor: string): Promise<SendRecord> {
  assertScheduled(await getSend(id));
  return updateSend(id, (r) => {
    if (r.status !== "scheduled") throw new Error("이미 실행됐거나 취소된 예약입니다");
    return {
      ...r, status: "canceled", canceledBy: actor, canceledAt: new Date().toISOString(), snapshot: undefined,
      recipients: r.recipients.map((x) => (x.status === "pending" ? { ...x, status: "skipped" as const, error: SKIP_REASON.canceled } : x)),
    };
  });
}

export async function rescheduleSend(id: string, iso: string): Promise<SendRecord> {
  const at = parseZonedInstant(iso);
  if (!at) throw new Error("예약 시각은 시간대가 붙은 ISO 형식이어야 합니다");
  const err = validateScheduleTime(at);
  if (err) throw new Error(err);
  assertScheduled(await getSend(id));
  return updateSend(id, (r) => {
    if (r.status !== "scheduled") throw new Error("이미 실행됐거나 취소된 예약입니다");
    return { ...r, scheduledAt: at.toISOString() };
  });
}

/** Remove one person from a pending schedule (they will not receive it). */
export async function removeScheduledRecipient(id: string, email: string): Promise<SendRecord> {
  const e = email.toLowerCase().trim();
  assertScheduled(await getSend(id));
  return updateSend(id, (r) => {
    if (r.status !== "scheduled") throw new Error("이미 실행됐거나 취소된 예약입니다");
    const recipients = r.recipients.filter((x) => x.email !== e);
    if (recipients.length === 0) throw new Error("마지막 수신자는 뺄 수 없습니다 — 예약을 취소하세요");
    return {
      ...r,
      recipients,
      excludedEmails: Array.from(new Set([...(r.excludedEmails ?? []), e])),
      summary: { ...r.summary, total: recipients.length },
    };
  });
}

/**
 * Re-sync a pending schedule with the current members of `slug`.
 * - slug is a target list: drop people who left it (unless another target list or the typed-in part still has them),
 *   refresh names, add new members — keeping every exclusion (excluded lists, excluded addresses, suppression).
 * - slug is an excluded list: drop pending people who are now in it.
 */
export async function refreshScheduledList(id: string, slug: string): Promise<{ added: number; removed: number }> {
  const rec = await getSend(id);
  assertScheduled(rec);
  const isTarget = rec.listSlugs.includes(slug);
  const isExcluded = (rec.excludeListSlugs ?? []).includes(slug);
  if (!isTarget && !isExcluded) return { added: 0, removed: 0 };

  const list = await getList(slug);
  const members = new Map((list?.members ?? []).map((m) => [m.email.toLowerCase(), m]));
  const excludedByList = new Set(
    (await resolveListMembersWithOrigin(rec.excludeListSlugs ?? [])).map((m) => m.email.toLowerCase()),
  );
  // Other target lists, to keep (and relabel) people who left `slug` but are still in another selected list.
  const otherTargets = new Map(
    (await resolveListMembersWithOrigin(rec.listSlugs.filter((s) => s !== slug))).map((m) => [m.email.toLowerCase(), m.listSlug]),
  );
  const excludedEmails = new Set(rec.excludedEmails ?? []);
  const supp = await suppressedSet(Array.from(members.keys()));

  let added = 0, removed = 0;
  await updateSend(id, (r) => {
    if (r.status !== "scheduled") throw new Error("이미 실행됐거나 취소된 예약입니다");
    let recipients = r.recipients;
    if (isExcluded) {
      recipients = recipients.filter((x) => {
        if (x.status === "pending" && excludedByList.has(x.email)) { removed++; return false; }
        return true;
      });
    }
    if (isTarget) {
      recipients = recipients.flatMap((x) => {
        if (x.listSlug !== slug) return [x];
        const m = members.get(x.email);
        if (m) return [{ ...x, name: m.name, company: m.company, title: m.title }];
        const other = otherTargets.get(x.email);
        if (other) return [{ ...x, listSlug: other }];
        removed++;
        return [];
      });
      const present = new Set(recipients.map((x) => x.email));
      for (const [email, m] of Array.from(members.entries())) {
        if (present.has(email) || excludedByList.has(email) || excludedEmails.has(email) || supp.has(email)) continue;
        recipients.push({ email, name: m.name, company: m.company, title: m.title, listSlug: slug, status: "pending" });
        added++;
      }
    }
    if (recipients.length > MAX_RECIPIENTS_PER_SEND) {
      throw new Error(`갱신하면 ${recipients.length}명이 되어 1회 최대 ${MAX_RECIPIENTS_PER_SEND}명을 넘습니다`);
    }
    if (recipients.length === 0) throw new Error("갱신하면 수신자가 0명이 됩니다 — 예약을 취소하세요");
    return { ...r, recipients, summary: { ...r.summary, total: recipients.length } };
  });
  return { added, removed };
}

/**
 * Replace a pending schedule's frozen content with the email as currently saved
 * (asked when an email that has pending schedules is saved). Same build rules as an immediate send.
 */
export async function refreshScheduledContent(id: string): Promise<SendRecord> {
  const rec = await getSend(id);
  assertScheduled(rec);
  const built = await buildFullHtml(rec.templateName);
  if (!built) throw new Error("이메일을 찾을 수 없습니다");
  const html = rec.isAd ? ensureUnsubFooter(built.html) : built.html;
  const subject = rec.isAd && !/^\(광고\)/.test(built.subject) ? `(광고) ${built.subject}` : built.subject;
  return updateSend(id, (r) => {
    if (r.status !== "scheduled") throw new Error("이미 실행됐거나 취소된 예약입니다");
    return {
      ...r,
      subject,
      templateTitle: built.title,
      htmlHash: contentFingerprint(built.html, built.subject),
      snapshot: { html, subject, hasUnsub: hasUnsubLink(html) },
    };
  });
}
