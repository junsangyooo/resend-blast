/**
 * Unsubscribe token — HMAC-signed (reuses AUTH_SESSION_SECRET). nodejs routes only.
 * Prevents tampering of the one-time URL embedded in the email body (blocks unsubscribing arbitrary addresses).
 * token = base64url(payload).base64url(hmac), payload = { e: email, s: sendId, t: issuedAtSec }.
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
 * Returns { email, sendId, purpose } if valid, else null. No expiry (unsubscribe must always work).
 * If expectedPurpose is given, only passes when the token's purpose matches (prevents resubscribing via a leaked unsubscribe link).
 * Legacy tokens (no p) are treated as "unsub" — for compatibility with unsubscribe links in already-sent mail.
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
    const purpose: TokenPurpose = obj.p === "resub" ? "resub" : "unsub"; // legacy/unspecified → unsub
    if (expectedPurpose && purpose !== expectedPurpose) return null;
    return { email: obj.e, sendId: String(obj.s ?? ""), purpose };
  } catch {
    return null;
  }
}

/** Unsubscribe URL to embed in the email body (HTTPS). */
export function unsubscribeUrl(email: string, sendId: string): string {
  const token = makeUnsubToken(email, sendId, "unsub");
  return `${appBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Resubscribe URL — a separate purpose-scoped token (can't resubscribe via a leaked unsubscribe link). Goes in the confirmation mail. */
export function resubscribeUrl(email: string, sendId: string): string {
  const token = makeUnsubToken(email, sendId, "resub");
  return `${appBaseUrl()}/api/resubscribe?token=${encodeURIComponent(token)}`;
}

/** mailto unsubscribe address (the mailto option of List-Unsubscribe). */
export function unsubscribeMailto(): string {
  // The operator handles it manually from the received mail, or inbound handling can be added later.
  return `mailto:${brand.senders.contactEmail}?subject=unsubscribe`;
}
