import { NextRequest, NextResponse } from "next/server";
import { saveComposedTemplate } from "@/lib/templates";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 블록 조립기 결과 저장: {name}.json + {name}.html + _meta.json
export async function POST(req: NextRequest) {
  try {
    const actor = await requireUserEmail();
    const { name, spec, description, overwrite } = await req.json();
    await saveComposedTemplate(String(name ?? ""), spec, description ?? "", actor, { overwrite: !!overwrite });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "저장 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("이미 같은 이름") ? 409 : 400 });
  }
}
