/**
 * 로컬 디스크 스토리지 어댑터 — 외부 계정 0개.
 *
 * 업로드 이미지를 서버 디스크(data/uploads/)에 저장하고, 앱이 자기 공개 도메인으로
 * 서빙하는 URL(`{appBaseUrl}/api/assets/{file}`)을 반환한다. 서빙은 app/api/assets/[file].
 *
 * - delivery="attach" (기본): 발송 시 이 로컬 이미지를 CID 인라인 첨부로 메일에 박는다
 *   → 공개 URL이 필요 없다(lib/email-images.ts).
 * - delivery="hosted": 위 URL을 그대로 참조 → 앱이 공개 도메인으로 떠 있어야 한다.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { StorageAdapter } from "../types";
import { brand } from "../../../brand.config";

export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export class LocalAdapter implements StorageAdapter {
  readonly name = "local";

  async put(data: Buffer, _contentType: string, ext: string): Promise<string> {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const file = `${randomUUID()}.${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, file), data);
    const base = brand.identity.appBaseUrl.replace(/\/+$/, "");
    return `${base}/api/assets/${file}`;
  }
}
