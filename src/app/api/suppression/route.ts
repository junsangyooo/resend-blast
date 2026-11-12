import { NextRequest, NextResponse } from "next/server";
import { listSuppressions, unsuppress, suppress } from "@/lib/suppression";
import { isValidEmail } from "@/lib/recipients";
import { requireUserEmail } from "@/lib/auth";
import { isAdminAsync } from "@/lib/admins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 수신거부/반송/스팸신고 억제 목록. 조회·직접 추가는 누구나, 해제는 관리자만(오등록 복구용). */
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

/** 직접 추가 — 메일·전화 등으로 받은 수신거부 요청을 기록 (List-Unsubscribe mailto 포함). */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireUserEmail();
    const { email, note } = await req.json();
    const e = String(email ?? "").toLowerCase().trim();
    if (!isValidEmail(e)) return NextResponse.json({ error: "이메일 형식이 올바르지 않습니다" }, { status: 400 });
    const memo = String(note ?? "").trim().slice(0, 100);
    await suppress(e, "manual", `manual:${actor}${memo ? ` · ${memo}` : ""}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "실패" }, { status: 400 });
  }
}
