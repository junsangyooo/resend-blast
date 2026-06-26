/**
 * Asset storage entry point — public API.
 *
 * Callers (app/api/upload, app/api/logos) import only this module.
 * Which storage backend to use is determined by the single `assets.provider` value in `brand.config.ts`.
 *
 * ── Adding a new storage backend ──────────────────────────────────────────
 *   1) Write one StorageAdapter implementation in lib/storage/adapters/<name>.ts
 *   2) Register one line in ADAPTERS below
 *   3) Change assets.provider in brand.config.ts to "<name>"
 *   4) Add that storage's keys to .env.local
 *   → Don't touch the code body (callers).
 */
import { brand } from "../../brand.config";
import type { StorageAdapter } from "./types";
import { AzureAdapter } from "./adapters/azure";
import { LocalAdapter } from "./adapters/local";
import {
  EXT_BY_TYPE,
  detectImageType,
  isAllowedImageType,
} from "./image-validation";

// ── Adapter registry ★add a new storage backend here in one line ──
const ADAPTERS: Record<string, () => StorageAdapter> = {
  local: () => new LocalAdapter(), // zero external accounts (default) — disk storage + app serves it
  azure: () => new AzureAdapter(),
};

function getAdapter(): StorageAdapter {
  const provider = brand.assets.provider;
  const factory = ADAPTERS[provider];
  if (!factory) {
    const known = Object.keys(ADAPTERS).join(", ");
    throw new Error(
      `알 수 없는 스토리지 provider: "${provider}" (등록된 것: ${known}). ` +
        `brand.config.ts 의 assets.provider 또는 lib/storage/index.ts 의 ADAPTERS 를 확인하세요.`
    );
  }
  return factory();
}

/**
 * Validate the image buffer, then upload to the selected storage and return the public URL.
 * Uses the real type detected from magic bytes for content-type (ignores the client-reported value).
 * Signature matches the previous lib/azure.ts uploadImage — callers unaffected.
 */
export async function uploadImage(data: Buffer, claimedType: string): Promise<string> {
  if (!isAllowedImageType(claimedType)) {
    throw new Error(`지원하지 않는 이미지 형식: ${claimedType}`);
  }
  const realType = detectImageType(data);
  if (!realType) {
    throw new Error("파일이 PNG/JPG/GIF/WEBP 형식이 아닙니다 (헤더 검증 실패)");
  }
  // If the claimed type and the real type disagree, use the real type (jpg/jpeg treated the same)
  const ext = EXT_BY_TYPE[realType];
  return getAdapter().put(data, realType, ext);
}

// Re-exported because callers (routes) use these validation utils as a pre-block.
export { isAllowedImageType, MAX_UPLOAD_BYTES } from "./image-validation";
export type { StorageAdapter } from "./types";
