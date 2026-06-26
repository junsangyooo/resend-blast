/**
 * Google OAuth 2.0 Authorization Code flow helpers. Uses fetch only, no libraries.
 * Enforces the domain restriction (@ALLOWED_DOMAIN).
 */

import { brand } from "../brand.config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const OAUTH_STATE_COOKIE = "blast_oauth";

export function allowedDomain(): string {
  return brand.auth.loginDomain;
}

/** Allowed public hosts (prevents open redirects via spoofed Host/X-Forwarded-Host). */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>(["localhost:3001", "127.0.0.1:3001"]);
  try { hosts.add(new URL(brand.identity.appBaseUrl).host); } catch {}
  return hosts;
}

/**
 * The request's actual public origin. To stay correct behind a reverse proxy (e.g., Caddy),
 * prefer X-Forwarded-Proto / X-Forwarded-Host, but validate the host against a whitelist.
 * If the host is spoofed, don't trust it and fall back to the configured appBaseUrl (blocks phishing redirects).
 * (Local: no headers → host=localhost:3001, proto=http)
 */
export function originFromRequest(req: {
  headers: Headers;
  nextUrl: { protocol: string; host: string };
}): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  if (allowedHosts().has(host)) return `${proto}://${host}`;
  return brand.identity.appBaseUrl.replace(/\/+$/, "");
}

/** Google consent screen URL. Includes state (nonce). */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    hd: allowedDomain(), // company domain hint
    state,
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

type IdInfo = { email?: string; email_verified?: boolean | string; hd?: string };

/** Exchange code → id_token, then parse email info. */
export async function exchangeCode(code: string, redirectUri: string): Promise<IdInfo> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`token exchange 실패: ${r.status} ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  if (!j.id_token) throw new Error("id_token 없음");
  return decodeIdToken(j.id_token);
}

/** The id_token came directly from Google's token endpoint over TLS, so decoding the payload alone is safe. */
function decodeIdToken(idToken: string): IdInfo {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("잘못된 id_token");
  const pad = payload.length % 4 ? 4 - (payload.length % 4) : 0;
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
}

/** Company domain check. Returns the normalized email if it passes, else null.
 * The hd claim is required to block login-domain emails created outside Workspace (AND condition). */
export function verifyDomain(info: IdInfo): string | null {
  const email = (info.email ?? "").toLowerCase().trim();
  const verified = info.email_verified === true || info.email_verified === "true";
  if (!email || !verified) return null;
  const domain = allowedDomain().toLowerCase();
  const okHd = (info.hd ?? "").toLowerCase() === domain;
  const okEmail = email.endsWith(`@${domain}`);
  return okHd && okEmail ? email : null;
}
