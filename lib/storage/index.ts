/**
 * 자산 스토리지 진입점 — 공개 API.
 *
 * 호출부(app/api/upload, app/api/logos)는 이 모듈만 import 한다.
 * 어느 스토리지 백엔드를 쓸지는 `brand.config.ts`의 `assets.provider` 한 값으로 정해진다.
 *
 * ── 새 스토리지 추가하기 ──────────────────────────────────────────────────
 *   1) lib/storage/adapters/<name>.ts 에 StorageAdapter 구현 1개 작성
 *   2) 아래 ADAPTERS 에 한 줄 등록
 *   3) brand.config.ts 의 assets.provider 를 "<name>" 으로 변경
 *   4) .env.local 에 해당 스토리지 키 추가
 *   → 코드 본문(호출부)은 건드리지 않는다.
 */
import { brand } from "../../brand.config";
import type { StorageAdapter } from "./types";
import { AzureAdapter } from "./adapters/azure";
import {
  EXT_BY_TYPE,
  detectImageType,
  isAllowedImageType,
} from "./image-validation";

// ── 어댑터 레지스트리 ★새 스토리지는 여기에 한 줄 추가 ──
const ADAPTERS: Record<string, () => StorageAdapter> = {
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
 * 이미지 버퍼를 검증한 뒤 선택된 스토리지에 올리고 공개 URL을 반환.
 * content-type은 magic bytes로 판별된 실제 타입을 사용 (클라이언트 신고값 무시).
 * 시그니처는 기존 lib/azure.ts 의 uploadImage 와 동일 — 호출부 무손상.
 */
export async function uploadImage(data: Buffer, claimedType: string): Promise<string> {
  if (!isAllowedImageType(claimedType)) {
    throw new Error(`지원하지 않는 이미지 형식: ${claimedType}`);
  }
  const realType = detectImageType(data);
  if (!realType) {
    throw new Error("파일이 PNG/JPG/GIF/WEBP 형식이 아닙니다 (헤더 검증 실패)");
  }
  // 신고한 타입과 실제 타입이 어긋나면 실제 타입을 사용 (jpg/jpeg 동일시)
  const ext = EXT_BY_TYPE[realType];
  return getAdapter().put(data, realType, ext);
}

// 검증 유틸은 호출부(라우트)가 사전 차단용으로 그대로 쓰므로 재노출.
export { isAllowedImageType, MAX_UPLOAD_BYTES } from "./image-validation";
export type { StorageAdapter } from "./types";
