/**
 * Asset (image) storage abstraction — adapter interface.
 *
 * A storage backend (Azure Blob / S3 / R2 / local disk …) only needs to implement
 * this interface. Which backend to use is chosen by the single `assets.provider`
 * value in `brand.config.ts`. See docs/white-label.md for how to add a new backend.
 *
 * ⚠️ Adapters only receive "already validated" buffers. Image format validation
 *    (magic-bytes, allowed formats, size limit) is handled upfront by provider-agnostic
 *    shared logic (lib/storage/image-validation.ts); the adapter focuses solely on storing
 *    and returning a public URL.
 */
export interface StorageAdapter {
  /** Adapter identifier (for logging/error messages). */
  readonly name: string;

  /**
   * Store a validated image buffer and return a publicly accessible URL.
   * @param data      image bytes
   * @param contentType  finalized MIME type (e.g. "image/png")
   * @param ext       extension (no dot, e.g. "png")
   */
  put(data: Buffer, contentType: string, ext: string): Promise<string>;
}
