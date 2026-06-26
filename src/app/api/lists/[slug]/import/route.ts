import { NextRequest, NextResponse } from "next/server";
import { importMembers } from "@/lib/lists";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** body: { members: [{email, name?}], mode: "merge"|"replace" }
 *  Actual file parsing happens on the client (lib/import-parser.ts) → only the cleaned member array is sent.
 *  Owner/admin only (route-level auth — defense in depth). */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const actor = await requireUserEmail();
    const { members, mode } = await req.json();
    if (!Array.isArray(members)) {
      return NextResponse.json({ error: "members 배열이 필요합니다" }, { status: 400 });
    }
    if (members.length > 50000) {
      return NextResponse.json({ error: "한 번에 임포트할 수 있는 최대 인원은 50,000명입니다" }, { status: 400 });
    }
    const m = mode === "replace" ? "replace" : "merge";
    const list = await importMembers(params.slug, members, m, actor);
    return NextResponse.json({ list });
  } catch (e: any) {
    const msg = e?.message ?? "임포트 실패";
    const status = msg === "unauthenticated" ? 401 : msg.includes("권한") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
