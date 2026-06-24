import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { inlineLocalImages } from "./email-images";
import { UPLOAD_DIR } from "./storage/adapters/local";

const FILE = "test-inline-abc123.png";
const FPATH = path.join(UPLOAD_DIR, FILE);

describe("inlineLocalImages (CID attach)", () => {
  it("rewrites local image src to cid:, attaches base64, leaves external URLs", async () => {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(FPATH, Buffer.from("hello-png-bytes"));

    const html =
      `<img src="https://app.example.com/api/assets/${FILE}">` +
      `<img src="https://cdn.other.com/logo.png">`;
    const { html: out, attachments } = await inlineLocalImages(html);

    // 로컬 이미지 → cid:
    expect(out).toContain(`src="cid:img-${FILE}"`);
    // 외부 CDN 이미지는 그대로 hosted
    expect(out).toContain("https://cdn.other.com/logo.png");

    expect(attachments).toHaveLength(1);
    const a = attachments[0];
    expect(a.inlineContentId).toBe(`img-${FILE}`);
    expect(a.filename).toBe(FILE);
    expect(a.contentType).toBe("image/png");
    expect(Buffer.from(a.content, "base64").toString()).toBe("hello-png-bytes");
  });

  it("dedupes a repeated local image into one attachment", async () => {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(FPATH, Buffer.from("x"));
    const html =
      `<img src="https://a/api/assets/${FILE}"><img src="https://a/api/assets/${FILE}">`;
    const { attachments } = await inlineLocalImages(html);
    expect(attachments).toHaveLength(1);
  });

  it("returns no attachments when no local images present", async () => {
    const { attachments } = await inlineLocalImages(`<img src="https://cdn.other.com/x.png">`);
    expect(attachments).toHaveLength(0);
  });

  afterAll(async () => {
    await fs.rm(FPATH, { force: true });
  });
});
