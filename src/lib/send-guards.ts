/**
 * Send guards:
 * - contentHash: fingerprint of send content (sender/template/subject/recipient set). For idempotency (duplicate-send) checks.
 * - globalThrottle: enforces a minimum interval across all send streams within a single Node process.
 *   Even if two users send concurrently, a global serial interval keeps us under Resend's global rate (5/sec).
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

// Module-scope state — shared by all requests within a next start (single process). Single-threaded JS makes sync sections atomic.
let _nextSlot = 0;

/** Wait until the next send slot while guaranteeing a global minimum interval. The gap is maintained even across concurrent send streams. */
export async function globalThrottle(minGapMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, _nextSlot);
  _nextSlot = slot + minGapMs;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
