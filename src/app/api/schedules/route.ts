import { NextRequest, NextResponse } from "next/server";
import { listSends } from "@/lib/send-log";
import { requireUserEmail } from "@/lib/auth";
import { canManageAsync } from "@/lib/admins";
import { schedulerBootAt } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled sends for the schedule tab: upcoming first, then past ones (last 30 days).
 * `?list=slug` → only pending schedules that use that list (list-edit warning).
 */
export async function GET(req: NextRequest) {
  let me: string;
  try {
    me = await requireUserEmail();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const list = req.nextUrl.searchParams.get("list");
  const all = (await listSends()).filter((s) => !!s.scheduledAt);
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let rows = all.filter((s) => s.status === "scheduled" || new Date(s.scheduledAt!).getTime() >= since);
  // A list matters to a schedule whether it is sent to or excluded from it.
  if (list) rows = rows.filter((s) => s.status === "scheduled" && (s.listSlugs.includes(list) || (s.excludeListSlugs ?? []).includes(list)));
  const upcoming = rows.filter((s) => s.status === "scheduled").sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const past = rows.filter((s) => s.status !== "scheduled").sort((a, b) => b.scheduledAt!.localeCompare(a.scheduledAt!));
  const withPerm = await Promise.all([...upcoming, ...past].map(async (s) => ({ ...s, canManage: await canManageAsync(s.sentBy, me) })));
  // Only problems this user can act on (own schedules; admins see all) — others' issues would just be noise.
  const problems = withPerm.filter((s) => s.canManage && !!s.problem && !s.problemAcknowledged).length;
  return NextResponse.json({
    schedules: withPerm,
    upcomingCount: upcoming.length,
    problems,
    schedulerRunning: schedulerBootAt() !== null,
  });
}
