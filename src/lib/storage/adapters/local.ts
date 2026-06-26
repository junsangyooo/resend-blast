/**
 * Local disk storage adapter — zero external accounts.
 *
 * Stores uploaded images on the server disk (data/uploads/) and returns a URL the app
 * serves from its own public domain (`{appBaseUrl}/api/assets/{file}`). Serving is in app/api/assets/[file].
 *
 * - delivery="attach" (default): embeds these local images as CID inline attachments at send time
 *   → no public URL needed (lib/email-images.ts).
 * - delivery="hosted": references the URL above directly → the app must be up on a public domain.
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
