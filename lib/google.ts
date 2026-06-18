/**
 * Google OAuth 2.0 Authorization Code flow 헬퍼. 라이브러리 없이 fetch만 사용.
 * 도메인 제한(@ALLOWED_DOMAIN)을 강제한다.
 */

import { brand } from "../brand.config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const OAUTH_STATE_COOKIE = "blast_oauth";

export function allowedDomain(): string {
  return brand.auth.loginDomain;
}

/** 허용된 공개 호스트(스푸핑된 Host/X-Forwarded-Host 로 오픈리다이렉트 방지). */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>(["localhost:3001", "127.0.0.1:3001"]);
  try { hosts.add(new URL(brand.identity.appBaseUrl).host); } catch {}
  return hosts;
}

/**
 * 요청의 실제 공개 origin. Caddy 등 리버스 프록시 뒤에서도 정확하도록
 * X-Forwarded-Proto / X-Forwarded-Host 를 우선 사용하되, 호스트는 화이트리스트로 검증한다.
 * 스푸핑된 호스트면 신뢰하지 않고 설정된 appBaseUrl 로 폴백(피싱 리다이렉트 차단).
 * (로컬: 헤더 없음 → host=localhost:3001, proto=http)
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

/** 구글 인증 화면 URL. state(nonce) 포함. */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    hd: allowedDomain(), // 회사 도메인 힌트
    state,
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

type IdInfo = { email?: string; email_verified?: boolean | string; hd?: string };

/** code → id_token 교환 후 이메일 정보 파싱. */
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

/** id_token은 구글 토큰 엔드포인트에서 TLS로 직접 받았으므로 payload 디코드만 해도 안전. */
function decodeIdToken(idToken: string): IdInfo {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("잘못된 id_token");
  const pad = payload.length % 4 ? 4 - (payload.length % 4) : 0;
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
}

/** 회사 도메인 검증. 통과하면 정규화된 email 반환, 아니면 null.
 * Workspace 외부에서 만든 @rlwrld.ai 이메일을 차단하려면 hd 클레임 필수 (AND 조건). */
export function verifyDomain(info: IdInfo): string | null {
  const email = (info.email ?? "").toLowerCase().trim();
  const verified = info.email_verified === true || info.email_verified === "true";
  if (!email || !verified) return null;
  const domain = allowedDomain().toLowerCase();
  const okHd = (info.hd ?? "").toLowerCase() === domain;
  const okEmail = email.endsWith(`@${domain}`);
  return okHd && okEmail ? email : null;
}
