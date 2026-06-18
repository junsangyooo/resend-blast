import { NextRequest, NextResponse } from "next/server";
import { listSenders, listSendersAll, addSender, removeSender } from "@/lib/senders";
import { requireUserEmail } from "@/lib/auth";
import { isAdminAsync } from "@/lib/admins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 발신자 레지스트리 — 공용(shared)은 관리자만, 개인(personal)은 본인 주소 닉네임만.
 *  ?all=1 (관리자 전용): personal 포함 전체 — 레거시/타인 personal 항목 정리용. */
export async function GET(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    const wantAll = req.nextUrl.searchParams.get("all") === "1";
    if (wantAll && (await isAdminAsync(email))) {
      return NextResponse.json({ senders: await listSendersAll() });
    }
    return NextResponse.json({ senders: await listSenders(email.toLowerCase()) });
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    const { value, label, scope } = await req.json();
    const wantPersonal = scope === "personal";
    if (!wantPersonal && !(await isAdminAsync(email))) {
      return NextResponse.json({ error: "공용 발신자는 관리자만 추가할 수 있습니다" }, { status: 403 });
    }
    const sender = await addSender(String(value ?? ""), String(label ?? ""), {
      scope: wantPersonal ? "personal" : "shared",
      owner: wantPersonal ? email.toLowerCase() : undefined,
    });
    return NextResponse.json({ sender });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "추가 실패" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    const value = req.nextUrl.searchParams.get("value");
    if (!value) return NextResponse.json({ error: "value 없음" }, { status: 400 });
    const r = await removeSender(value, email, await isAdminAsync(email));
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "삭제 실패" }, { status: 400 });
  }
}
