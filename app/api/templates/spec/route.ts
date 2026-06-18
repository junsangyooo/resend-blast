import { NextRequest, NextResponse } from "next/server";
import { getTemplateSpec, listTemplates } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 재편집용 spec + description 로드. 블록 조립기로 만든 템플릿만 spec 존재.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name 없음" }, { status: 400 });
  const spec = await getTemplateSpec(name);
  const meta = (await listTemplates()).find((t) => t.name === name);
  return NextResponse.json({ spec, description: meta?.description ?? "" });
}
