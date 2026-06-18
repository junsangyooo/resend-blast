/**
 * 수신거부 토큰 — HMAC 서명(AUTH_SESSION_SECRET 재사용). nodejs 라우트 전용.
 * 이메일 본문에 박히는 1회용 URL 의 위변조를 막는다(임의 주소 수신거부 방지).
 * 토큰 = base64url(payload).base64url(hmac), payload = { e: email, s: sendId, t: issuedAtSec }.
 */
import crypto from "crypto";
import { appBaseUrl } from "./config";
import { brand } from "../brand.config";

function secret(): string {
  const s = process.env.AUTH_SESSION_SECRET || process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET 환경변수가 필요합니다");
  }
  return "dev-insecure-secret";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64");
}

export type TokenPurpose = "unsub" | "resub";

export function makeUnsubToken(email: string, sendId: string, purpose: TokenPurpose = "unsub"): string {
  const payload = JSON.stringify({ e: String(email).toLowerCase().trim(), s: sendId, p: purpose, t: Math.floor(Date.now() / 1000) });
  const body = b64url(Buffer.from(payload, "utf-8"));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * 유효하면 { email, sendId, purpose }, 아니면 null. 만료는 두지 않음(수신거부는 항상 유효해야 함).
 * expectedPurpose 가 주어지면 토큰 용도가 일치할 때만 통과(유출된 수신거부 링크로 재구독 방지).
 * 레거시 토큰(p 없음)은 "unsub" 으로 간주 — 이미 발송된 메일의 수신거부 링크 호환.
 */
export function verifyUnsubToken(
  token: string | undefined | null,
  expectedPurpose?: TokenPurpose
): { email: string; sendId: string; purpose: TokenPurpose } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const obj = JSON.parse(b64urlToBuf(body).toString("utf-8")) as { e?: string; s?: string; p?: string };
    if (!obj.e || typeof obj.e !== "string") return null;
    const purpose: TokenPurpose = obj.p === "resub" ? "resub" : "unsub"; // 레거시/미지정 → unsub
    if (expectedPurpose && purpose !== expectedPurpose) return null;
    return { email: obj.e, sendId: String(obj.s ?? ""), purpose };
  } catch {
    return null;
  }
}

/** 이메일 본문에 들어갈 수신거부 URL (HTTPS). */
export function unsubscribeUrl(email: string, sendId: string): string {
  const token = makeUnsubToken(email, sendId, "unsub");
  return `${appBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** 재구독 URL — 용도가 분리된 별도 토큰(유출된 수신거부 링크로 재구독 불가). 확인 메일에 넣는다. */
export function resubscribeUrl(email: string, sendId: string): string {
  const token = makeUnsubToken(email, sendId, "resub");
  return `${appBaseUrl()}/api/resubscribe?token=${encodeURIComponent(token)}`;
}

/** mailto 수신거부 주소 (List-Unsubscribe 의 mailto 옵션). */
export function unsubscribeMailto(): string {
  // 운영자가 받은 메일을 보고 수동 처리하거나, 추후 inbound 처리 가능.
  return `mailto:${brand.senders.contactEmail}?subject=unsubscribe`;
}
