import { NextRequest, NextResponse } from "next/server";
import { listSends, cleanupStaleSends, EXECUTED_STATUSES } from "@/lib/send-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// instrumentation.ts 부팅 정리의 안전망. 이력 폴링 흐름에서도 5분에 1회만 실행.
let lastCleanupAt = 0;
const CLEANUP_THROTTLE_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const list = req.nextUrl.searchParams.get("list");
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 50));

  // 부팅 hook 이 빠진 환경(예: next dev with HMR)을 위한 lazy cleanup.
  if (Date.now() - lastCleanupAt > CLEANUP_THROTTLE_MS) {
    lastCleanupAt = Date.now();
    cleanupStaleSends().catch(() => {});
  }

  // History = executed sends only. Pending/canceled/missed schedules live in the schedule tab.
  let sends = (await listSends()).filter((s) => EXECUTED_STATUSES.includes(s.status));
  if (list) sends = sends.filter((s) => s.listSlugs.includes(list));
  return NextResponse.json({ sends: sends.slice(0, limit) });
}
