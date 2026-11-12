import { NextRequest, NextResponse } from "next/server";
import { listSuppressions, unsuppress, suppress } from "@/lib/suppression";
import { isValidEmail } from "@/lib/recipients";
import { requireUserEmail } from "@/lib/auth";
import { isAdminAsync } from "@/lib/admins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Suppression list (unsubscribed/bounced/spam-reported). Anyone can view and add manually; only admins can remove (to recover from mistaken entries). */
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

/** Manual add: record unsubscribe requests received by email, phone, etc. (including List-Unsubscribe mailto). */
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
