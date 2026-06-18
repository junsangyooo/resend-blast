import { NextRequest, NextResponse } from "next/server";
import { getTemplateBody, listTemplates } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// HTML 직접 입력 템플릿의 raw body + meta(subject/description) 를 편집기에 로드한다.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name 없음" }, { status: 400 });
  const body = await getTemplateBody(name);
  if (body === null) return NextResponse.json({ error: "이메일 없음" }, { status: 404 });
  const meta = (await listTemplates()).find((t) => t.name === name);
  return NextResponse.json({
    name,
    body,
    subject: meta?.subject ?? "",
    description: meta?.description ?? "",
    composed: meta?.composed ?? false,
  });
}
