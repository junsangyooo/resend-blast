import { NextRequest, NextResponse } from "next/server";
import { duplicateTemplate } from "@/lib/templates";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Copy an email into a new one owned by the caller. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireUserEmail();
    const { name } = await req.json();
    const copy = await duplicateTemplate(String(name ?? ""), actor);
    return NextResponse.json({ ok: true, ...copy });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "복제 실패" }, { status: 400 });
  }
}
