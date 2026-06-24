import { NextRequest, NextResponse } from "next/server";
import { listSuppressions, unsuppress } from "@/lib/suppression";
import { requireUserEmail } from "@/lib/auth";
import { isAdminAsync } from "@/lib/admins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unsubscribe/bounce/complaint suppression list. Anyone can view, only admins can remove (for recovering mis-registrations). */
export async function GET() {
  return NextResponse.json({ suppressions: await listSuppressions() });
}

export async function DELETE(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    if (!(await isAdminAsync(email))) return NextResponse.json({ error: "관리자만 억제 해제할 수 있습니다" }, { status: 403 });
    const target = req.nextUrl.searchParams.get("email");
    if (!target) return NextResponse.json({ error: "email 없음" }, { status: 400 });
    await unsuppress(target);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "실패" }, { status: 400 });
  }
}
