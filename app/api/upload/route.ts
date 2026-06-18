import { NextRequest, NextResponse } from "next/server";
import { uploadImage, isAllowedImageType, MAX_UPLOAD_BYTES } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
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
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "업로드 실패" }, { status: 500 });
  }
}
