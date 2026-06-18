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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RETRIES = 1;
const RETRY_BASE_MS = 1000;
const DEDUPE_WINDOW_MS = 90_000; // 90초 내 동일 내용 재발송은 중복으로 차단(더블클릭/재시도)

type SendBody = {
  template: string;
  listSlugs?: string[];
  adhoc?: string;
  from?: string;
  replyTo?: string;
  isAd?: boolean;
  /** 본인 검수용 테스트 발송 — 현재 로그인 사용자에게만 1건. */
  testToSelf?: boolean;
  /** 팔로업(재발송): 원본 send id + 필터로 대상 자동 산출. */
  sourceSendId?: string;
  followupFilter?: "failed" | "unopened";
  /** 멱등성 중복 차단을 무시하고 강제 발송. */
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

  // 템플릿 푸터의 수신거부 링크 포함 여부(토글). 포함된 경우에만 본문 링크/헤더를 주입한다.
  // (강제하지 않음 — 포함 여부는 템플릿 생성 시 운영자가 선택.)
  const hasUnsub = built.html.includes(UNSUB_PLACEHOLDER);

  // 광고성 메일은 본문에 수신거부 방법 표시가 법적 의무(정보통신망법 §50). 헤더만으론 불충분.
  if (!isTest && !!body.isAd && !hasUnsub) {
    return json({
      error: "광고성((광고)) 메일은 본문에 수신거부 링크가 있어야 합니다. 블록 이메일 푸터의 ‘수신거부 링크’를 켜거나, HTML 본문에 %%UNSUB_URL%% 를 포함한 뒤 다시 발송하세요.",
    }, 400);
  }

  // ── 1) 수신자 산출 ──
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
      // 리마인더: 전달(Delivered) 확인이 안 된 수신자만 — opened/clicked 추적이 불안정해
      // 열람 기준 대신 전달 기준. 반송/신고는 어차피 suppression 으로 자동 제외.
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
    // 그리드 파서로 ad-hoc 처리 — 이름+이메일 매핑 보존 (탭/파이프/쉼표/「이름 <이메일>」).
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

  // ── 2) 억제목록(수신거부/반송/스팸신고) 제외 — 테스트 발송은 제외하지 않음 ──
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

  // ── 3) 수신자 수 상한 ──
  if (!isTest && merged.length > MAX_RECIPIENTS_PER_SEND) {
    return json({ error: `1회 발송 최대 ${MAX_RECIPIENTS_PER_SEND}명을 초과했습니다 (${merged.length}명). 리스트를 나눠 보내세요.` }, 400);
  }

  // ── 4) From / reply-to 검증 — 미등록 발신자는 조용한 폴백 없이 거부 ──
  // (의도와 다른 발신자(launch@)로 발송되는 운영 사고 방지. 빈 값만 기본 발신자.)
  const finalFrom = String(body.from ?? "").trim() || FROM_DEFAULT;
  if (!isFromAllowed(finalFrom)) return json({ error: "허용되지 않은 발신자 도메인입니다" }, 400);
  if (!(await isSenderAllowedFor(finalFrom, sentBy))) {
    return json({ error: "사용할 수 없는 발신자입니다. 공용 발신자 또는 본인 계정만 사용할 수 있습니다 (발신자를 다시 선택하세요)." }, 400);
  }
  const replyTo = resolveReplyTo(body.replyTo);

  // ── 5) 사용자 발송 레이트리밋 (테스트 제외) ──
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

  // ── 6) 제목: 광고성이면 (광고) 접두 ──
  const baseSubject = built.subject;
  const subject = body.isAd && !/^\(광고\)/.test(baseSubject) ? `(광고) ${baseSubject}` : baseSubject;

  // ── 7) 멱등성: 90초 내 동일 내용 재발송 차단 (테스트 제외) ──
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

  // ── 8) send 레코드 생성 (running) ──
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
        // 중단 요청 확인 — UI 의 '발송 중단' 버튼이 레코드 abortRequested 를 세팅하면 다음 반복에서 종료.
        if (!isTest) {
          const cur = await getSend(sendId).catch(() => null);
          if (cur?.abortRequested) { aborted = true; break; }
        }

        // 전역 스로틀: 동시 발송 스트림 간에도 Resend 한도(초당 5건)를 넘지 않게 간격 유지.
        await globalThrottle(SEND_MIN_GAP_MS);

        const rec = merged[i];
        const to = rec.email;
        // 발송 중 수신거부/반송된 주소는 건너뛴다(장시간 블라스트 도중 원클릭 수신거부 대비).
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
        // 본문 수신거부 링크: 템플릿이 포함한 경우에만(토글 존중).
        // List-Unsubscribe 헤더: 본문 링크가 있거나 광고성 발송이면 부착 — 발송을 막지 않으면서
        // 광고 메일의 Gmail/Yahoo 원클릭 수신거부(보이지 않는 헤더)는 항상 동작하도록 보장.
        const includeUnsubHeader = !isTest && (hasUnsub || !!body.isAd);
        const unsubUrl = includeUnsubHeader ? unsubscribeUrl(to, sendId) : "#";
        const html = fillPlaceholders(built.html, {
          name: rec.name,
          email: to,
          unsubscribeUrl: hasUnsub && !isTest ? unsubUrl : "#",
        });
        // 제목도 수신자별 개인화 치환(평문 — escape 없음).
        const recipientSubject = fillSubject(subject, { name: rec.name, email: to });
        const headers = includeUnsubHeader ? {
          "List-Unsubscribe": `<${unsubUrl}>, <${mailtoUnsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : undefined;

        let attempt = 0, success = false, lastErr = "", resendId: string | undefined;
        while (attempt <= MAX_RETRIES && !success) {
          try {
            const { data, error } = await resend.emails.send({
              // replyTo 가 비어있으면 헤더 미부착 → 수신자 회신이 From 주소로 감.
              from: finalFrom, to, ...(replyTo ? { replyTo } : {}), subject: recipientSubject, html, headers,
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
