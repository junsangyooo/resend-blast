/**
 * Personalization placeholder substitution — lightweight module shared by server/client.
 *
 * Why it's split out from lib/blocks.ts (the renderer): so the send-confirmation modal can
 * substitute the per-recipient preview directly in the browser without a network round trip.
 * This file must never have server-only dependencies like fs.
 *
 * Supported tokens (case-insensitive, whitespace allowed):
 *  - {{name}}             recipient name (blank if absent)
 *  - {{firstName}}        first word of the name (blank if absent)
 *  - {{name|default}}     use the default if name is absent — same for firstName
 *  - {{email}}            recipient email
 *  - %%UNSUB_URL%%        unsubscribe URL (per-recipient signed URL injected at send time)
 */

export const UNSUB_PLACEHOLDER = "%%UNSUB_URL%%";

export type PersonalizeVars = {
  name?: string;
  email?: string;
  unsubscribeUrl?: string;
};

/** {{key}} / {{key|fallback}} — key is name/firstName/email (case-insensitive). */
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

/** Substitution for HTML body — values are inserted HTML-escaped. */
export function fillPlaceholders(html: string, v: PersonalizeVars): string {
  return html
    .replace(TOKEN_RE, (_m, key: string, fb: string | undefined) => escHtml(resolveToken(key, fb, v)))
    .split(UNSUB_PLACEHOLDER)
    .join(escHtml(v.unsubscribeUrl ?? "#"));
}

/** Substitution for plain text like subjects — values as-is without escaping. Does not handle the unsubscribe token. */
export function fillSubject(subject: string, v: PersonalizeVars): string {
  return subject.replace(TOKEN_RE, (_m, key: string, fb: string | undefined) => resolveToken(key, fb, v));
}

/** Whether the body/subject contains any personalization token. */
export function usesPersonalization(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/**
 * Whether a name token ({{name}}/{{firstName}}) is used without a default.
 * If true, that slot is sent blank to recipients without a name → a pre-send warning case.
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
