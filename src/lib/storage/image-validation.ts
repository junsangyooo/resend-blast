/**
 * Image format validation — provider-agnostic shared logic.
 *
 * Kept outside the adapters since it's security validation applied identically
 * regardless of storage backend. (Previously mixed into lib/azure.ts.)
 */

// SVG is removed due to the script-execution risk in the preview iframe. Only PNG/JPG/GIF/WEBP allowed.
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

/** Detect the real format from the buffer's magic bytes. Don't trust the client-reported content-type. */
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
