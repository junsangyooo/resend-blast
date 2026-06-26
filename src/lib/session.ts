/**
 * Session token = HS256 JWT. Uses Web Crypto only → works in both Edge middleware and Node routes.
 * No external libraries.
 */

export const SESSION_COOKIE = "blast_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

type Payload = { email: string; iat: number; exp: number };

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}
function b64urlDecodeStr(s: string): string {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function secret(): string {
  const s = process.env.AUTH_SESSION_SECRET || process.env.JWT_SECRET;
  if (s) return s;
  // No silent fallback if the key is missing in production — fail-fast to prevent token forgery.
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET (또는 JWT_SECRET) 환경변수가 필요합니다");
  }
  return "dev-insecure-secret";
}

export async function createSession(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { email, iat: now, exp: now + SESSION_MAX_AGE };
  const header = b64urlEncodeStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncodeStr(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret());
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** payload if valid, else null. (Verifies signature and expiry) */
export async function verifySession(token: string | undefined | null): Promise<Payload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    // Defend against algorithm confusion (alg:none / RS256 confusion): accept only HS256.
    const hdr = JSON.parse(b64urlDecodeStr(header)) as { alg?: string; typ?: string };
    if (hdr.alg !== "HS256") return null;
    const key = await hmacKey(secret());
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!ok) return null;
    const payload = JSON.parse(b64urlDecodeStr(body)) as Payload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
