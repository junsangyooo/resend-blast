/**
 * 개인화 자리표시자 치환 — 서버/클라이언트 공용 경량 모듈.
 *
 * lib/blocks.ts(렌더러)에서 분리한 이유: 발송 확인 모달이 수신자별 미리보기를
 * 네트워크 왕복 없이 브라우저에서 직접 치환하기 위함. 이 파일은 fs 등
 * 서버 전용 의존성을 절대 가지면 안 된다.
 *
 * 지원 토큰 (대소문자 무관, 공백 허용):
 *  - {{name}}             수신자 이름 (없으면 빈칸)
 *  - {{firstName}}        이름의 첫 단어 (없으면 빈칸)
 *  - {{name|기본값}}      이름이 없으면 기본값 사용 — firstName 도 동일
 *  - {{email}}            수신자 이메일
 *  - %%UNSUB_URL%%        수신거부 URL (발송 시 수신자별 서명 URL 주입)
 */

export const UNSUB_PLACEHOLDER = "%%UNSUB_URL%%";

export type PersonalizeVars = {
  name?: string;
  email?: string;
  unsubscribeUrl?: string;
};

/** {{key}} / {{key|fallback}} — key 는 name/firstName/email (대소문자 무관). */
const TOKEN_RE = /\{\{\s*(name|first[_ ]?name|email)\s*(?:\|([^{}]*))?\}\}/gi;

function escHtml(s: string | undefined | null): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstNameOf(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function resolveToken(rawKey: string, fallback: string | undefined, v: PersonalizeVars): string {
  const key = rawKey.toLowerCase().replace(/[_ ]/g, "");
  let val = "";
  if (key === "name") val = (v.name ?? "").trim();
  else if (key === "firstname") val = firstNameOf(v.name);
  else if (key === "email") val = (v.email ?? "").trim();
  return val || (fallback ?? "").trim();
}

/** HTML 본문용 치환 — 값은 HTML escape 되어 들어간다. */
export function fillPlaceholders(html: string, v: PersonalizeVars): string {
  return html
    .replace(TOKEN_RE, (_m, key: string, fb: string | undefined) => escHtml(resolveToken(key, fb, v)))
    .split(UNSUB_PLACEHOLDER)
    .join(escHtml(v.unsubscribeUrl ?? "#"));
}

/** 제목 등 평문용 치환 — escape 없이 값 그대로. 수신거부 토큰은 다루지 않는다. */
export function fillSubject(subject: string, v: PersonalizeVars): string {
  return subject.replace(TOKEN_RE, (_m, key: string, fb: string | undefined) => resolveToken(key, fb, v));
}

/** 본문/제목에 개인화 토큰이 하나라도 있는가. */
export function usesPersonalization(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/**
 * 이름 토큰({{name}}/{{firstName}})이 기본값 없이 쓰였는가.
 * true 면 이름 없는 수신자에게 해당 자리가 빈칸으로 발송된다 → 발송 전 경고 대상.
 */
export function hasBlankNameRisk(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text))) {
    const key = m[1].toLowerCase().replace(/[_ ]/g, "");
    const fallback = (m[2] ?? "").trim();
    if ((key === "name" || key === "firstname") && !fallback) return true;
  }
  return false;
}
