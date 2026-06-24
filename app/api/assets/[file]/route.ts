/**
 * 로컬 업로드 이미지 서빙 — delivery="hosted" 일 때 메일 클라이언트가 외부에서 로드.
 * 공개 라우트(미들웨어 allowlist). path traversal 방지 + 안전한 파일명만 허용.
 */
import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { UPLOAD_DIR } from "@/lib/storage/adapters/local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  const file = params.file ?? "";
  // 안전한 파일명만 (영숫자·._-), 디렉토리 분리자/상위참조 차단.
  if (!/^[a-zA-Z0-9._-]+$/.test(file) || file.includes("..")) {
    return new Response("Not found", { status: 404 });
  }
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const ct = CONTENT_TYPE[ext];
  if (!ct) return new Response("Not found", { status: 404 });

  try {
    const data = await fs.readFile(path.join(UPLOAD_DIR, file));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
