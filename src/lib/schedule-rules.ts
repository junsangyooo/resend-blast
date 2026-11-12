/**
 * Scheduling rules — pure, testable.
 *
 * Policy (decided by the team): a schedule whose time passed while the server was down is NOT run
 * ("missed"); schedules still in the future at boot are picked up again automatically.
 */

export const MIN_LEAD_MS = 60 * 1000;               // at least 1 minute ahead
export const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000; // at most 90 days ahead

export type DueAction = "none" | "run" | "missed";

/** What the scheduler should do with a record right now. bootAt = when this server process started. */
export function dueAction(rec: { status: string; scheduledAt?: string }, now: number, bootAt: number): DueAction {
  if (rec.status !== "scheduled" || !rec.scheduledAt) return "none";
  const at = new Date(rec.scheduledAt).getTime();
  if (!Number.isFinite(at)) return "missed";
  if (at > now) return "none";
  // Due before this process existed → the server was off at that moment.
  return at < bootAt ? "missed" : "run";
}

export function validateScheduleTime(at: Date, now: number = Date.now()): string | null {
  const t = at.getTime();
  if (!Number.isFinite(t)) return "예약 시각이 올바르지 않습니다";
  if (t < now + MIN_LEAD_MS) return "예약 시각은 지금부터 1분 이후여야 합니다";
  if (t > now + MAX_LEAD_MS) return "예약은 90일 이내로만 할 수 있습니다";
  return null;
}

/** How many more recipients may be sent now under the hourly/daily caps. */
export function remainingAllowance(hourVol: number, dayVol: number, hourLimit: number, dayLimit: number): number {
  return Math.max(0, Math.min(hourLimit - hourVol, dayLimit - dayVol));
}

/** Only accept instants with an explicit zone ("Z" or ±hh:mm) — a bare "2026-11-12T09:00" would be read in the server's zone. */
export function parseZonedInstant(iso: unknown): Date | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(iso.trim())) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}
