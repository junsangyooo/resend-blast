/**
 * 발송 시 로컬 업로드 이미지를 CID 인라인 첨부로 변환 (delivery="attach").
 *
 * 본문 HTML에서 우리 자산 경로(`/api/assets/<file>`)를 가리키는 img src 를 찾아:
 *  1) data/uploads/<file> 를 디스크에서 읽어 base64 첨부(inlineContentId)로 만들고
 *  2) 해당 src 를 `cid:<id>` 로 치환한다.
 * → 외부 호스팅·공개 URL 없이도 이미지가 메일에 박혀 나간다.
 *
 * 안전: 디스크의 로컬 파일만 읽는다(임의 외부 URL fetch 없음 → SSRF 불가).
 * 외부 CDN/오브젝트 스토리지 URL(예: 브랜드 로고)은 그대로 hosted 로 둔다.
 *
 * Resend SDK(v4) 첨부 필드: { filename, content(base64), contentType, inlineContentId }.
 * HTML 에서는 `<img src="cid:<inlineContentId>">` 로 참조한다.
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
 * 본문 HTML 의 로컬 이미지를 CID 첨부로 변환.
 * 이미지는 수신자 무관(개인화 치환은 텍스트만 건드림)이므로 발송 루프 전 1회만 호출하고
 * 결과(html·attachments)를 모든 수신자에게 재사용한다.
 */
export async function inlineLocalImages(
  html: string,
): Promise<{ html: string; attachments: InlineImageAttachment[] }> {
  // src 가 우리 자산 경로를 가리키는 파일명을 수집 (중복 제거).
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
      continue; // 파일 없으면 그대로 둔다(hosted 로 남음).
    }

    const cid = `img-${file}`; // uuid.ext 기반 → 128자 미만, 메일 내 고유.
    attachments.push({
      filename: file,
      content: data.toString("base64"),
      contentType: ct,
      inlineContentId: cid,
    });

    // 호스트(appBaseUrl)가 달라져도 동작하도록 경로 기준으로 src URL 전체를 cid: 로 치환.
    const urlRe = new RegExp(`[^"'\\s)]*\\/api\\/assets\\/${escapeRegExp(file)}`, "g");
    out = out.replace(urlRe, `cid:${cid}`);
  }

  return { html: out, attachments };
}
