/**
 * Azure Blob storage adapter.
 *
 * Uploads images to the same container as logos and returns a public URL.
 * Credentials (account/key/container) are read only from .env.local — not brand.config.
 * Path: {container}/assets/email-blast/{uuid}.{ext}
 */
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { randomUUID } from "crypto";
import type { StorageAdapter } from "../types";

const PREFIX = "assets/email-blast";

export class AzureAdapter implements StorageAdapter {
  readonly name = "azure";

  async put(data: Buffer, contentType: string, ext: string): Promise<string> {
    const account = process.env.AZURE_STORAGE_ACCOUNT;
    const key = process.env.AZURE_STORAGE_KEY;
    const container = process.env.AZURE_STORAGE_CONTAINER ?? "email-blast-assets";

    if (!account || !key) {
      throw new Error("AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY 환경변수가 없습니다");
    }

    const cred = new StorageSharedKeyCredential(account, key);
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, cred);
    const containerClient = service.getContainerClient(container);

    const blobName = `${PREFIX}/${randomUUID()}.${ext}`;
    const blob = containerClient.getBlockBlobClient(blobName);
    await blob.uploadData(data, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        blobCacheControl: "public, max-age=31536000, immutable",
      },
    });
    return blob.url;
  }
}
