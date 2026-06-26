import { NextRequest, NextResponse } from "next/server";
import { getList, updateList, deleteList } from "@/lib/lists";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const list = await getList(params.slug);
  if (!list) return NextResponse.json({ error: "리스트를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ list });
}

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const actor = await requireUserEmail();
    const { name, description, members } = await req.json();
    const next = await updateList(params.slug, {
      ...(name !== undefined ? { name: String(name) } : {}),
      ...(description !== undefined ? { description: String(description) } : {}),
      ...(members !== undefined ? { members } : {}),
    }, actor);
    return NextResponse.json({ list: next });
  } catch (e: any) {
    const msg = e?.message ?? "수정 실패";
    const status = msg.includes("권한") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const email = await requireUserEmail();
    await deleteList(params.slug, email);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "삭제 실패";
    const status = msg.includes("생성자만") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
