import { NextRequest, NextResponse } from "next/server";
import { listAll, createList, getList } from "@/lib/lists";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — by default returns summary only. With `?with=members&slugs=a,b,c`, also returns the members of the given slugs
 * (a batch endpoint to eliminate SendForm's N+1 fetch).
 */
export async function GET(req: NextRequest) {
  const withMembers = req.nextUrl.searchParams.get("with") === "members";
  const slugsParam = req.nextUrl.searchParams.get("slugs");

  if (withMembers && slugsParam) {
    const slugs = slugsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const lists = await Promise.all(slugs.map((s) => getList(s)));
    return NextResponse.json({
      lists: lists
        .filter((l): l is NonNullable<typeof l> => !!l)
        .map((l) => ({ slug: l.slug, name: l.name, members: l.members })),
    });
  }
  return NextResponse.json({ lists: await listAll() });
}

export async function POST(req: NextRequest) {
  try {
    const email = await requireUserEmail();
    const { name, description, members, slug } = await req.json();
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "리스트 이름이 필요합니다" }, { status: 400 });
    }
    const list = await createList({
      name: name.trim(),
      description: description ?? "",
      members: Array.isArray(members) ? members : [],
      slug: slug ? String(slug) : undefined,
      createdBy: email,
    });
    return NextResponse.json({ list });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "생성 실패" }, { status: 400 });
  }
}
