import { NextRequest, NextResponse } from "next/server";
import { buildFullHtmlFromSpec } from "@/lib/templates";
import { previewFill } from "@/lib/blocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// spec(JSON) → 풀 HTML (저장 안 함, 실시간 미리보기용). 개인화/수신거부 토큰은 샘플값으로 치환.
export async function POST(req: NextRequest) {
  try {
    const { spec } = await req.json();
    if (!spec || typeof spec !== "object") {
      return NextResponse.json({ error: "spec 없음" }, { status: 400 });
    }
    // DoS 가드: 과도한 블록/페이로드 거부.
    if (Array.isArray(spec.blocks) && spec.blocks.length > 100) {
      return NextResponse.json({ error: "블록이 너무 많습니다 (최대 100개)" }, { status: 400 });
    }
    const built = buildFullHtmlFromSpec(spec);
    return NextResponse.json({ subject: built.subject, html: previewFill(built.html) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "렌더 실패" }, { status: 400 });
  }
}
