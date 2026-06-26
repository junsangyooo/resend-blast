import { NextRequest, NextResponse } from "next/server";
import { listSends, cleanupStaleSends } from "@/lib/send-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Safety net for instrumentation.ts boot cleanup. Even in the sidebar polling flow, runs at most once every 5 minutes.
let lastCleanupAt = 0;
const CLEANUP_THROTTLE_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const list = req.nextUrl.searchParams.get("list");
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 50));

  // Lazy cleanup for environments missing the boot hook (e.g. next dev with HMR).
  if (Date.now() - lastCleanupAt > CLEANUP_THROTTLE_MS) {
    lastCleanupAt = Date.now();
    cleanupStaleSends().catch(() => {});
  }

  let sends = await listSends();
  if (list) sends = sends.filter((s) => s.listSlugs.includes(list));
  return NextResponse.json({ sends: sends.slice(0, limit) });
}
