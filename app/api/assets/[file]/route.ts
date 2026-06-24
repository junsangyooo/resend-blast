/**
 * Serves locally uploaded images — loaded externally by the mail client when delivery="hosted".
 * Public route (middleware allowlist). Prevents path traversal + allows only safe filenames.
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
  // Safe filenames only (alphanumeric, ._-); block directory separators/parent references.
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
