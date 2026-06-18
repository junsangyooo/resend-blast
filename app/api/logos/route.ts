import { NextRequest, NextResponse } from "next/server";
import { listLogos, addLogo, removeLogo } from "@/lib/logos";
import { uploadImage, isAllowedImageType, MAX_UPLOAD_BYTES } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 헤더 로고 목록
export async function GET() {
  return NextResponse.json({ logos: await listLogos() });
}

// 로고 업로드: Azure 업로드 → data/logos.json 에 등록
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const label = String(form.get("label") ?? "").trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }
    if (!label) {
      return NextResponse.json({ error: "로고 이름을 입력하세요" }, { status: 400 });
    }
    if (!isAllowedImageType(file.type)) {
      return NextResponse.json(
        { error: `지원 형식: PNG/JPG/GIF/WEBP (받은 형식: ${file.type || "알 수 없음"})` },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "이미지는 5MB 이하만 가능합니다" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const url = await uploadImage(buf, file.type);
    const logo = await addLogo(label, url);
    return NextResponse.json({ logo });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "업로드 실패" }, { status: 500 });
  }
}

// 커스텀 로고 삭제 (내장 로고는 lib/logos.ts 에서 보호)
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 없음" }, { status: 400 });
  const r = await removeLogo(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
