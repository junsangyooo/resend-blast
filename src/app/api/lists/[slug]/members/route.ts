import { NextRequest, NextResponse } from "next/server";
import { addListMembers } from "@/lib/lists";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Append members — open to every signed-in user (removal/editing stays owner/admin only). */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const actor = await requireUserEmail();
    const { members } = await req.json();
    if (!Array.isArray(members) || members.length === 0) {
      return NextResponse.json({ error: "추가할 멤버가 없습니다" }, { status: 400 });
    }
    const { list, added } = await addListMembers(params.slug, members, actor);
    return NextResponse.json({ list, added });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "추가 실패" }, { status: 400 });
  }
}
