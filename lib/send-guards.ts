/**
 * 발송 가드:
 * - contentHash: 발송 내용(보낸이/템플릿/제목/수신자 집합)의 지문. 멱등성(중복 발송) 검사용.
 * - globalThrottle: 단일 Node 프로세스 내에서 모든 발송 스트림에 걸쳐 최소 간격을 강제.
 *   두 사용자가 동시에 발송해도 Resend 글로벌 레이트(초당 5건)를 넘지 않게 전역 직렬 간격을 둔다.
 */
import crypto from "crypto";

export function contentHash(parts: {
  sentBy: string;
  from: string;
  templateName: string;
  subject: string;
  emails: string[];
}): string {
  const norm = [...parts.emails].map((e) => e.toLowerCase().trim()).sort().join(",");
  const h = crypto.createHash("sha256");
  h.update(`${parts.sentBy}\n${parts.from}\n${parts.templateName}\n${parts.subject}\n${norm}`);
  return h.digest("hex");
}

// 모듈 스코프 상태 — next start(단일 프로세스)에서 모든 요청이 공유. JS 단일 스레드라 동기 구간은 원자적.
let _nextSlot = 0;

/** 전역 최소 간격을 보장하며 다음 발송 슬롯까지 대기. 동시 발송 스트림 간에도 간격이 유지된다. */
export async function globalThrottle(minGapMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, _nextSlot);
  _nextSlot = slot + minGapMs;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
