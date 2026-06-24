/**
 * On send, convert locally uploaded images into CID inline attachments (delivery="attach").
 *
 * In the body HTML, find img src values pointing at our asset path (`/api/assets/<file>`):
 *  1) read data/uploads/<file> from disk and turn it into a base64 attachment (inlineContentId), and
 *  2) replace that src with `cid:<id>`.
 * → Images get embedded in the mail without external hosting or public URLs.
 *
 * Safety: reads only local files on disk (no arbitrary external URL fetch → no SSRF).
 * External CDN / object-storage URLs (e.g., the brand logo) are left as hosted.
 *
 * Resend SDK (v4) attachment fields: { filename, content(base64), contentType, inlineContentId }.
 * HTML references them via `<img src="cid:<inlineContentId>">`.
 */
import { promises as fs } from "fs";
import path from "path";
import { UPLOAD_DIR } from "./storage/adapters/local";

export type InlineImageAttachment = {
  filename: string;
  content: string; // base64
  contentType: string;
  inlineContentId: string;
};

const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert local images in the body HTML into CID attachments.
 * Images are recipient-independent (personalization only touches text), so call this once before the send loop
 * and reuse the result (html·attachments) for all recipients.
 */
export async function inlineLocalImages(
  html: string,
): Promise<{ html: string; attachments: InlineImageAttachment[] }> {
  // Collect filenames whose src points at our asset path (deduped).
  const fileRe = /\/api\/assets\/([a-zA-Z0-9._-]+)/g;
  const files = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(html))) {
    const f = m[1];
    if (/^[a-zA-Z0-9._-]+$/.test(f) && !f.includes("..")) files.add(f);
  }

  const attachments: InlineImageAttachment[] = [];
  let out = html;

  for (const file of files) {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    const ct = CONTENT_TYPE[ext];
    if (!ct) continue;

    let data: Buffer;
    try {
      data = await fs.readFile(path.join(UPLOAD_DIR, file));
    } catch {
      continue; // if the file is missing, leave it as is (stays hosted).
    }

    const cid = `img-${file}`; // based on uuid.ext → under 128 chars, unique within the mail.
    attachments.push({
      filename: file,
      content: data.toString("base64"),
      contentType: ct,
      inlineContentId: cid,
    });

    // Replace the entire src URL with cid: based on the path, so it works even if the host (appBaseUrl) changes.
    const urlRe = new RegExp(`[^"'\\s)]*\\/api\\/assets\\/${escapeRegExp(file)}`, "g");
    out = out.replace(urlRe, `cid:${cid}`);
  }

  return { html: out, attachments };
}
