/**
 * Node-only boot tasks, loaded from instrumentation.ts (never bundled for the Edge runtime).
 * - 재시작으로 끊긴 `running` send 를 즉시 aborted 로 정리 (예약 발송이면 예약 탭에 문제로 표시).
 * - 예약 발송 스케줄러 시작: 꺼져 있던 동안 지난 예약은 '실행 안 됨', 아직 안 온 예약은 그대로 살아난다.
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
    // 부팅을 막지 않는다. /api/sends 에도 lazy cleanup 백업이 있음.
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
