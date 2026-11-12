/**
 * Node-only boot tasks, loaded from instrumentation.ts (never bundled for the Edge runtime).
 * - Clean up `running` sends cut off by a restart by marking them aborted right away (scheduled sends are shown as a problem in the schedule tab).
 * - Start the scheduled-send scheduler: schedules that passed while the server was off become '실행 안 됨', and future ones are restored as-is.
 */
import { abortOrphanedSends } from "./send-log";
import { startScheduler } from "./scheduler";

export async function boot(): Promise<void> {
  try {
    // Single process: anything still "running" at boot was cut off by the restart.
    const fixed = await abortOrphanedSends();
    // eslint-disable-next-line no-console
    if (fixed > 0) console.log(`[boot] marked ${fixed} interrupted send(s) as aborted`);
  } catch (e) {
    // Don't block boot. /api/sends also has a lazy-cleanup backup.
    // eslint-disable-next-line no-console
    console.warn("[boot] abortOrphanedSends failed:", e);
  }
  try {
    startScheduler();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[boot] scheduler failed to start:", e);
  }
}
