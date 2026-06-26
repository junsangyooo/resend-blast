/**
 * Hook that runs once on Next.js server boot.
 * - Cleans up `running` sends that died mid-send by marking them aborted (data/sends/*.json).
 * - fs is inaccessible on the Edge runtime → only runs on the nodejs runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { cleanupStaleSends } = await import("./lib/send-log");
    const fixed = await cleanupStaleSends();
    if (fixed > 0) {
      // eslint-disable-next-line no-console
      console.log(`[instrumentation] cleaned up ${fixed} stale running send(s)`);
    }
  } catch (e) {
    // Don't block boot. There's a lazy cleanup backup during route handling too (/api/sends).
    // eslint-disable-next-line no-console
    console.warn("[instrumentation] cleanupStaleSends failed:", e);
  }
}
