import { NextRequest, NextResponse } from "next/server";
import { buildFullHtmlFromSpec } from "@/lib/templates";
import { previewFill } from "@/lib/blocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// spec(JSON) → full HTML (not saved, for live preview). Personalization/unsubscribe tokens are substituted with sample values.
export async function POST(req: NextRequest) {
  try {
    const { spec } = await req.json();
    if (!spec || typeof spec !== "object") {
      return NextResponse.json({ error: "spec 없음" }, { status: 400 });
    }
    // DoS guard: reject excessive blocks/payload.
    if (Array.isArray(spec.blocks) && spec.blocks.length > 100) {
      return NextResponse.json({ error: "블록이 너무 많습니다 (최대 100개)" }, { status: 400 });
    }
    const built = buildFullHtmlFromSpec(spec);
    return NextResponse.json({ subject: built.subject, html: previewFill(built.html) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "렌더 실패" }, { status: 400 });
  }
}
