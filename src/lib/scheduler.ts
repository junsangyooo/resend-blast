/**
 * In-process scheduler for scheduled sends (single `next start` process on the mini PC).
 *
 * - Started once per process from instrumentation.ts (guarded against HMR double-start).
 * - On start: schedules whose time already passed are marked "missed" — the server was off then,
 *   and by team policy those are not sent. Future schedules simply stay "scheduled" and get picked up.
 * - Every TICK_MS: due schedules are claimed (scheduled → running, under the per-send file lock,
 *   so a schedule can never start twice) and executed with the shared send loop.
 * - At execution time: sender permission, suppression and the hourly/daily caps are re-checked.
 *   Recipients over the cap are marked "skipped" and the problem is surfaced in the schedule tab.
 */
import { getSend, listRecords, updateSend, userSendVolume } from "./send-log";
import { dueAction, remainingAllowance } from "./schedule-rules";
import { executeSend } from "./send-runner";
import { isSenderAllowedFor } from "./senders";
import { suppressedSet } from "./suppression";
import { USER_DAILY_SEND_LIMIT, USER_HOURLY_SEND_LIMIT } from "./config";
import { PROBLEM, SKIP_REASON } from "./status-text";

const TICK_MS = 15_000;

type State = { bootAt: number; timer: ReturnType<typeof setInterval> | null; ticking: boolean };
const g = globalThis as unknown as { __ebScheduler?: State };

export function schedulerBootAt(): number | null {
  return g.__ebScheduler?.bootAt ?? null;
}

export function startScheduler(): void {
  if (g.__ebScheduler) return;
  const state: State = { bootAt: Date.now(), timer: null, ticking: false };
  g.__ebScheduler = state;
  tick().catch((e) => console.warn("[scheduler] first tick failed:", e));
  state.timer = setInterval(() => { tick().catch((e) => console.warn("[scheduler] tick failed:", e)); }, TICK_MS);
  state.timer.unref?.();
  console.log("[scheduler] started");
}

async function tick(): Promise<void> {
  const state = g.__ebScheduler;
  if (!state || state.ticking) return;
  state.ticking = true;
  try {
    const now = Date.now();
    const pending = await listRecords((r) => r.status === "scheduled");
    pending.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
    for (const rec of pending) {
      const action = dueAction(rec, now, state.bootAt);
      if (action === "missed") {
        await updateSend(rec.id, (r) => (r.status === "scheduled"
          ? {
              ...r, status: "missed", problem: PROBLEM.missed, finishedAt: new Date().toISOString(), snapshot: undefined,
              recipients: r.recipients.map((x) => (x.status === "pending" ? { ...x, status: "skipped" as const, error: SKIP_REASON.missed } : x)),
              summary: { ...r.summary, skipped: r.recipients.length },
            }
          : r)).catch(() => null);
      } else if (action === "run") {
        // Claim atomically; another tick or process that already claimed it leaves status != scheduled.
        let claimed = false;
        await updateSend(rec.id, (r) => {
          if (r.status !== "scheduled") return r;
          claimed = true;
          return { ...r, status: "running", startedAt: new Date().toISOString() };
        }).catch(() => null);
        // Run in the background so one long send does not delay other due schedules' claims.
        if (claimed) {
          runScheduled(rec.id).catch(async (e) => {
            console.warn("[scheduler] run failed:", rec.id, e);
            // Never leave it silently "running": stop it and say why in the schedule tab.
            await updateSend(rec.id, (r) => (r.status === "running"
              ? { ...r, status: "aborted", finishedAt: new Date().toISOString(), problem: PROBLEM.runError, problemAcknowledged: false }
              : r)).catch(() => null);
          });
        }
      }
    }
  } finally {
    state.ticking = false;
  }
}

async function runScheduled(id: string): Promise<void> {
  const rec = await getSend(id);
  if (!rec || !rec.snapshot) {
    await failWhole(id, PROBLEM.snapshotMissing, SKIP_REASON.snapshotMissing);
    return;
  }
  if (!(await isSenderAllowedFor(rec.from, rec.sentBy))) {
    await failWhole(id, PROBLEM.senderUnavailable, SKIP_REASON.senderUnavailable);
    return;
  }

  // Suppression may have changed since scheduling.
  const pendingEmails = rec.recipients.filter((r) => r.status === "pending").map((r) => r.email);
  const supp = await suppressedSet(pendingEmails);

  // Caps are checked now; the rest is left unsent and visible per recipient.
  const [hourVol, dayVol] = await Promise.all([
    userSendVolume(rec.sentBy, 60 * 60 * 1000, id),
    userSendVolume(rec.sentBy, 24 * 60 * 60 * 1000, id),
  ]);
  let allowance = remainingAllowance(hourVol, dayVol, USER_HOURLY_SEND_LIMIT, USER_DAILY_SEND_LIMIT);
  let overLimit = 0;
  await updateSend(id, (r) => {
    const recipients = r.recipients.map((x) => {
      if (x.status !== "pending") return x;
      if (supp.has(x.email.toLowerCase())) return { ...x, status: "skipped" as const, error: SKIP_REASON.suppressed };
      if (allowance <= 0) { overLimit++; return { ...x, status: "skipped" as const, error: SKIP_REASON.overLimit }; }
      allowance--;
      return x;
    });
    const skipped = recipients.filter((x) => x.status === "skipped").length;
    return {
      ...r,
      recipients,
      summary: { ...r.summary, skipped },
      excludedSuppressed: (r.excludedSuppressed ?? 0) + supp.size,
      ...(overLimit > 0 ? { problem: PROBLEM.overLimit(overLimit) } : {}),
    };
  });

  await executeSend({
    sendId: id,
    html: rec.snapshot.html,
    subject: rec.snapshot.subject,
    from: rec.from,
    replyTo: rec.replyTo,
    isAd: !!rec.isAd,
    isTest: false,
    hasUnsub: rec.snapshot.hasUnsub,
  });

  // Surface provider failures too.
  await updateSend(id, (r) => {
    const failed = r.recipients.filter((x) => x.status === "failed").length;
    if (failed === 0 || r.problem) return r;
    return { ...r, problem: PROBLEM.failed(failed) };
  }).catch(() => null);
}

async function failWhole(id: string, problem: string, reason: string): Promise<void> {
  await updateSend(id, (r) => ({
    ...r,
    status: "failed",
    problem,
    finishedAt: new Date().toISOString(),
    snapshot: undefined,
    recipients: r.recipients.map((x) => (x.status === "pending" ? { ...x, status: "skipped" as const, error: reason } : x)),
  })).catch(() => null);
}
