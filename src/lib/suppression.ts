/**
 * Unsubscribe/bounce/spam-complaint suppression list.
 * Storage: data/suppression.json — { [emailLower]: { reason, at, source } }
 * Excludes these addresses during the send dedupe step.
 * Sources: user unsubscribe (/api/unsubscribe), Resend webhook (bounced/complained).
 * Resend also does region-level auto-suppression, but we keep our own for proactive exclusion at send time + tracking display.
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";

const DATA_DIR = path.join(process.cwd(), "data");
const PATH = path.join(DATA_DIR, "suppression.json");
const LOCK_KEY = "suppression";

export type SuppressionReason = "unsubscribe" | "bounced" | "complained" | "manual";
export type SuppressionEntry = { email: string; reason: SuppressionReason; at: string; source?: string };
type Store = Record<string, SuppressionEntry>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function norm(email: string): string {
  return String(email ?? "").toLowerCase().trim();
}

async function read(): Promise<Store> {
  const s = await readJsonSafe<Store>(PATH, {});
  return s && typeof s === "object" ? s : {};
}

/** Add to the suppression list (idempotent). If already present, keep reason/at (preserve the first record). */
export async function suppress(email: string, reason: SuppressionReason, source?: string): Promise<void> {
  const e = norm(email);
  if (!EMAIL_RE.test(e)) return;
  await withFileLock(LOCK_KEY, async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const store = await read();
    if (!store[e]) {
      store[e] = { email: e, reason, at: new Date().toISOString(), source };
      await atomicWrite(PATH, JSON.stringify(store, null, 2));
    }
  });
}

/** Remove from suppression (for admin/mis-registration recovery). */
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

/** Return, in one pass, the Set of suppressed addresses among the given emails (for send dedupe). */
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
