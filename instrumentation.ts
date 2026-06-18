/**
 * Next.js 서버 부팅 시 1회 실행되는 hook.
 * - 발송 중 죽었던 `running` send 를 aborted 로 정리한다 (data/sends/*.json).
 * - Edge runtime 에선 fs 접근 불가 → nodejs runtime 일 때만 실행.
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
    // 부팅을 막지 않는다. 라우트 처리 중에도 lazy cleanup 백업이 있음 (/api/sends).
    // eslint-disable-next-line no-console
    console.warn("[instrumentation] cleanupStaleSends failed:", e);
  }
}
