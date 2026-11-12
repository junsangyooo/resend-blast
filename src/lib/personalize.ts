/**
 * Personalization placeholder substitution — lightweight module shared by server and client.
 *
 * Split out of lib/blocks.ts (the renderer) so the send-confirm modal can substitute
 * per-recipient previews directly in the browser, without a network round trip.
 * This file must never have server-only dependencies such as fs.
 *
 * Supported tokens (case-insensitive, whitespace allowed):
 *  - {{name}}             recipient name (blank if missing)
 *  - {{firstName}}        first word of the name (blank if missing)
 *  - {{name|fallback}}    use the fallback if there is no name — same for all tokens below
 *  - {{email}}            recipient email
 *  - {{company}}          recipient company (blank if missing)
 *  - {{title}}            recipient job title (blank if missing)
 *  - %%UNSUB_URL%%        unsubscribe URL (a per-recipient signed URL is injected at send time)
 */

export const UNSUB_PLACEHOLDER = "%%UNSUB_URL%%";

export type PersonalizeVars = {
  name?: string;
  email?: string;
  company?: string;
  title?: string;
  unsubscribeUrl?: string;
};

/** {{key}} / {{key|fallback}} — key is name/firstName/email/company/title (case-insensitive). */
const TOKEN_RE = /\{\{\s*(name|first[_ ]?name|email|company|title)\s*(?:\|([^{}]*))?\}\}/gi;

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
  else if (key === "company") val = (v.company ?? "").trim();
  else if (key === "title") val = (v.title ?? "").trim();
  return val || (fallback ?? "").trim();
}

/** Substitution for HTML bodies — values are HTML-escaped. */
export function fillPlaceholders(html: string, v: PersonalizeVars): string {
  return html
    .replace(TOKEN_RE, (_m, key: string, fb: string | undefined) => escHtml(resolveToken(key, fb, v)))
    .split(UNSUB_PLACEHOLDER)
    .join(escHtml(v.unsubscribeUrl ?? "#"));
}

/** Substitution for plain text such as subjects — values as-is, no escaping. Does not handle the unsubscribe token. */
export function fillSubject(subject: string, v: PersonalizeVars): string {
  return subject.replace(TOKEN_RE, (_m, key: string, fb: string | undefined) => resolveToken(key, fb, v));
}

/** Whether the body/subject contains at least one personalization token. */
export function usesPersonalization(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/**
 * Whether a name token ({{name}}/{{firstName}}) is used without a fallback.
 * If true, recipients without a name receive a blank in that spot → a pre-send warning target.
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
