/**
 * 이미지 형식 검증 — provider 무관 공통 로직.
 *
 * 어느 스토리지 백엔드를 쓰든 동일하게 적용되는 보안 검증이라 어댑터 밖에 둔다.
 * (이전엔 lib/azure.ts 안에 섞여 있었음.)
 */

// SVG는 미리보기 iframe에서 스크립트 실행 위험이 있어 제거. PNG/JPG/GIF/WEBP만 허용.
export const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

export function isAllowedImageType(type: string): boolean {
  return type in EXT_BY_TYPE;
}

/** 버퍼의 magic bytes로 실제 형식을 판별. 클라이언트가 신고한 content-type을 신뢰하지 않는다. */
export function detectImageType(buf: Buffer): keyof typeof EXT_BY_TYPE | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // WEBP: RIFF????WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}
