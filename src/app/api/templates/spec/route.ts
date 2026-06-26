import { NextRequest, NextResponse } from "next/server";
import { getTemplateSpec, listTemplates } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Load spec + description for re-editing. Only templates made with the block composer have a spec.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name 없음" }, { status: 400 });
  const spec = await getTemplateSpec(name);
  const meta = (await listTemplates()).find((t) => t.name === name);
  return NextResponse.json({ spec, description: meta?.description ?? "" });
}
