/**
 * Single source of truth for operational config.
 * - Sender (From) whitelist: senders.ts merges builtin + data/from.json (operator-added).
 *   Anything outside the brand sender domain (brand.auth.senderDomain) is blocked by isFromAllowed
 *   (prevents operator mistakes; separate from Resend's domain verification).
 * - Send abuse-prevention limits, admins, app URL, and compliance sender info are also managed here in one place.
 * Brand-dependent values come from brand.config.ts; secrets and per-environment values come from env vars.
 */
import { brand } from "../brand.config";

export type FromOption = {
  /** The actual RFC 5322 from value (e.g., "RLDX-1 by RLWRLD <launch@rlwrld.ai>") */
  value: string;
  /** UI display name */
  label: string;
  /** Builtin senders cannot be deleted */
  builtin?: boolean;
  /** "shared" = public (admin-managed, usable by everyone) / "personal" = personal (own address, visible/usable only to owner) */
  scope?: "shared" | "personal";
  /** Owner email of a personal sender (lowercase). */
  owner?: string;
};

/** Builtin senders (always present, cannot be deleted). Operator-added ones live in data/from.json (lib/senders.ts). */
export const BUILTIN_FROM: FromOption[] = brand.senders.builtinFrom;

export const FROM_DEFAULT = BUILTIN_FROM[0].value;
export const REPLY_TO_DEFAULT = brand.senders.replyToDefault;

/** Regex allowing only from/reply-to ending in brand.auth.senderDomain. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ALLOWED_FROM_DOMAIN = new RegExp(`@${escapeRegExp(brand.auth.senderDomain)}>?\\s*$`, "i");

/** @deprecated Silent fallback risks sender misdelivery — use isSenderAllowedFor in lib/senders.ts
 *  for send validation, and reject unregistered from with 400. */
export function resolveFrom(input: string | undefined | null): string {
  const v = String(input ?? "").trim();
  if (!v) return FROM_DEFAULT;
  if (BUILTIN_FROM.some((o) => o.value === v)) return v;
  return FROM_DEFAULT;
}

/** Safety net: enforce that no from/reply-to outside the @rlwrld.ai domain is used by any path. */
export function isFromAllowed(value: string): boolean {
  return ALLOWED_FROM_DOMAIN.test(value);
}

/** Extract just the address part (lowercase) from "Name <a@b.com>" or "a@b.com". "" on failure. */
function emailAddr(v: string | undefined | null): string {
  const s = String(v ?? "").trim();
  const m = s.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (m) return m[1].toLowerCase();
  return /^[^<>@\s]+@[^<>@\s]+$/.test(s) ? s.toLowerCase() : "";
}
const REPLY_TO_DEFAULT_ADDR = emailAddr(REPLY_TO_DEFAULT);

/** reply-to validation: empty → empty string (= no Reply-To header → replies go to From).
 *  Allowed: (a) an address on the senderDomain, or (b) the configured external reply address (brand.senders.replyToDefault).
 *  → Don't block operator-intended external (e.g., gmail) replies, but block injection of arbitrary external addresses. */
export function resolveReplyTo(input: string | undefined | null): string {
  const v = String(input ?? "").trim();
  if (!v) return "";
  if (isFromAllowed(v)) return v;
  if (REPLY_TO_DEFAULT_ADDR && emailAddr(v) === REPLY_TO_DEFAULT_ADDR) return v;
  return "";
}

// ── Send abuse-prevention limits (tunable via env vars) ──
function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
/** Max recipients per send. Sends exceeding this are rejected. */
export const MAX_RECIPIENTS_PER_SEND = intEnv("MAX_RECIPIENTS_PER_SEND", 1000);
/** Per-user 24-hour cumulative send limit. */
export const USER_DAILY_SEND_LIMIT = intEnv("USER_DAILY_SEND_LIMIT", 5000);
/** Per-user 1-hour cumulative send limit. */
export const USER_HOURLY_SEND_LIMIT = intEnv("USER_HOURLY_SEND_LIMIT", 2000);
/** Minimum gap between sends (ms). More conservative than Resend's default limit (5/sec). */
export const SEND_MIN_GAP_MS = intEnv("SEND_MIN_GAP_MS", 220);

// ── Admins (can edit/delete others' lists/templates, manage senders and admins) ──
// env ADMIN_EMAILS = permanent seed (cannot be deleted). Runtime additions live in data/admins.json (lib/admins.ts).
// Always use isAdminAsync / canManageAsync in lib/admins.ts for permission checks —
// this sync version sees only the env seed, so it misses file-registered admins.
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
/** @deprecated Checks only the env seed. Routes/libraries should use isAdminAsync in lib/admins.ts. */
export function isAdmin(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

// ── App public URL (for generating unsubscribe links in emails — the send loop has no request context, so use the env value) ──
export function appBaseUrl(): string {
  return brand.identity.appBaseUrl;
}

// ── Compliance footer: sender info (Korea's Network Act · CAN-SPAM) ──
/** Sender organization name (Network Act Article 50(4)). */
export const SENDER_ORG_NAME = brand.senders.orgName;
/** Sender physical postal address (CAN-SPAM requirement). Omitted from the footer if empty — must be filled before external sending. */
export const SENDER_POSTAL_ADDRESS = brand.senders.postalAddress;
/** Sender contact (email). */
export const SENDER_CONTACT_EMAIL = brand.senders.contactEmail;
