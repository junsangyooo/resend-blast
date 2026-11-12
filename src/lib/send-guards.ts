/**
 * Send guards:
 * - contentHash: fingerprint of the send content (sender/template/subject/recipient set). Used for idempotency (duplicate-send) checks.
 * - globalThrottle: enforces a minimum gap across all send streams within a single Node process.
 *   Keeps a global serial gap so two users sending at once don't exceed Resend's global rate (5/sec).
 */
import crypto from "crypto";

export function contentHash(parts: {
  sentBy: string;
  from: string;
  templateName: string;
  subject: string;
  emails: string[];
}): string {
  const norm = [...parts.emails].map((e) => e.toLowerCase().trim()).sort().join(",");
  const h = crypto.createHash("sha256");
  h.update(`${parts.sentBy}\n${parts.from}\n${parts.templateName}\n${parts.subject}\n${norm}`);
  return h.digest("hex");
}

/** Content fingerprint of an email (token-preserving html + subject). Detects "edited since last send". */
export function contentFingerprint(html: string, subject: string): string {
  return crypto.createHash("sha256").update(`${subject}\n${html}`).digest("hex");
}

// Module-scope state — shared by all requests under next start (single process). JS is single-threaded, so synchronous sections are atomic.
let _nextSlot = 0;

/** Wait for the next send slot while guaranteeing a global minimum gap. The gap holds across concurrent send streams too. */
export async function globalThrottle(minGapMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, _nextSlot);
  _nextSlot = slot + minGapMs;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
