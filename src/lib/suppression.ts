/**
 * Suppression list for unsubscribes / bounces / spam complaints.
 * Storage: data/suppression.json — { [emailLower]: { reason, at, source } }
 * Addresses in this list are excluded at the send dedupe step.
 * Sources: user unsubscribe (/api/unsubscribe), Resend webhook (bounced/complained), manual add (opt-out requests received by email, etc.).
 * Scope: company-wide. Addresses in this list are excluded no matter which sender is used.
 * Resend also does region-level automatic suppression, but we keep our own list to exclude up front at send time and to show tracking.
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";

const DATA_DIR = path.join(process.cwd(), "data");
const PATH = path.join(DATA_DIR, "suppression.json");
const LOCK_KEY = "suppression";

export type SuppressionReason = "unsubscribe" | "bounced" | "complained" | "manual";
export type SuppressionEntry = { email: string; reason: SuppressionReason; at: string; source?: string; updatedAt?: string };
type Store = Record<string, SuppressionEntry>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function norm(email: string): string {
  return String(email ?? "").toLowerCase().trim();
}

async function read(): Promise<Store> {
  const s = await readJsonSafe<Store>(PATH, {});
  return s && typeof s === "object" ? s : {};
}

/** Severity: a later complaint/bounce must not stay hidden behind an earlier unsubscribe. */
const REASON_RANK: Record<SuppressionReason, number> = { manual: 1, unsubscribe: 1, bounced: 2, complained: 3 };

/** Reasons a person may lift themselves (resubscribe link). Bounces/complaints need an admin. */
export function canSelfResubscribe(reason: SuppressionReason | undefined): boolean {
  return reason === "unsubscribe" || reason === "manual";
}

/**
 * Add to the suppression list (idempotent). If already present, keep the original record (at),
 * but escalate the reason if a more severe one (bounce/spam complaint) arrives.
 */
export async function suppress(email: string, reason: SuppressionReason, source?: string): Promise<void> {
  const e = norm(email);
  if (!EMAIL_RE.test(e)) return;
  await withFileLock(LOCK_KEY, async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const store = await read();
    const cur = store[e];
    if (!cur) {
      store[e] = { email: e, reason, at: new Date().toISOString(), source };
    } else if (REASON_RANK[reason] > REASON_RANK[cur.reason]) {
      store[e] = { ...cur, reason, source: source ?? cur.source, updatedAt: new Date().toISOString() };
    } else {
      return;
    }
    await atomicWrite(PATH, JSON.stringify(store, null, 2));
  });
}

export async function getSuppression(email: string): Promise<SuppressionEntry | null> {
  return (await read())[norm(email)] ?? null;
}

/** Remove from suppression (for admins / recovering mistaken entries). */
export async function unsuppress(email: string): Promise<void> {
  const e = norm(email);
  await withFileLock(LOCK_KEY, async () => {
    const store = await read();
    if (store[e]) {
      delete store[e];
      await atomicWrite(PATH, JSON.stringify(store, null, 2));
    }
  });
}

export async function isSuppressed(email: string): Promise<boolean> {
  const store = await read();
  return !!store[norm(email)];
}

/** Return, in one call, the Set of suppressed addresses among many emails (for send dedupe). */
export async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const store = await read();
  const out = new Set<string>();
  for (const raw of emails) {
    const e = norm(raw);
    if (store[e]) out.add(e);
  }
  return out;
}

export async function listSuppressions(): Promise<SuppressionEntry[]> {
  const store = await read();
  return Object.values(store).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
