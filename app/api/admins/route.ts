import { NextRequest, NextResponse } from "next/server";
import { listAdmins, addAdmin, removeAdmin, isAdminAsync } from "@/lib/admins";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 관리자 레지스트리 — 조회·추가·삭제 모두 관리자만. env 시드는 삭제 불가. */
export async function GET() {
  try {
    const email = await requireUserEmail();
    if (!(await isAdminAsync(email))) return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
    return NextResponse.json({ admins: await listAdmins() });
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    if (!(await isAdminAsync(email))) return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
    const { email: target } = await req.json();
    const admin = await addAdmin(String(target ?? ""));
    return NextResponse.json({ admin });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "추가 실패" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    if (!(await isAdminAsync(email))) return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
    const target = req.nextUrl.searchParams.get("email");
    if (!target) return NextResponse.json({ error: "email 없음" }, { status: 400 });
    const r = await removeAdmin(target, email);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "삭제 실패" }, { status: 400 });
  }
}
