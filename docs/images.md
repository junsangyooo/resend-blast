# Image Pipeline Guide — Every Way to Put Images in an Email

There are **exactly 2 ways** to put images in an email, and this app supports both (switch with a single line in `brand.config.ts`).
**Each method needs different infrastructure** — this document explains all of it.

> Common misconception: "Do I need to stand up a server to use CID (attachments)?" → **No.** With CID the image is embedded in the email itself, so **no public server is needed at all.** What requires a server/bucket is the **hosted (URL) method**.

## 0. The Two Axes

Image settings are defined by **2 axes** under `assets` in `brand.config.ts`.

```ts
assets: {
  provider: "local",     // storage: where images are kept     (local | azure | r2 | …)
  delivery: "attach",    // delivery: how images go in the email (attach | hosted)
}
```

- **provider** = **where** uploaded images are **stored**
- **delivery** = **how** stored images are **placed in the email** (attached vs referenced by URL)

## 1. The Two Email Image Methods (How They Work)

| | **attach (CID inline attachment)** | **hosted (URL reference)** |
|---|---|---|
| HTML | `<img src="cid:imageID">` | `<img src="https://…/x.png">` |
| Image location | embedded **inside the email** as base64 | on an **external public URL**, fetched when opened |
| Public server needed? | ❌ No | ✅ Yes (the app or bucket must be on a public domain) |
| Persistence | preserved permanently with the email | image breaks if the URL goes down |
| Bulk efficiency | ❌ re-sent to every recipient | ✅ uploaded once, shared |
| Size limit | 40MB per email (after base64) | effectively none |

→ **Small / personal sends = attach**, **bulk sends = hosted** is the right answer.

## 2. Decision Guide — Which Combination Fits My Situation?

| Situation | provider | delivery | Required infrastructure |
|---|---|---|---|
| **Personal / small, simplest** | `local` | `attach` | **None** (just server disk) |
| Medium scale, app already on a public domain | `local` | `hosted` | public domain + persistent disk |
| Bulk / CDN, multiple servers | `r2` (or azure/s3) | `hosted` | object storage bucket |

Below, each path is explained step by step — **what to set up and how to wire it together**.

---

## Path A. `local` + `attach` — Zero Infrastructure (default, recommended)

**What you need: nothing.** No external accounts, no public URL, no separate server.

**Pipeline (already implemented):**
```
[upload]  UI image upload → /api/upload → server disk data/uploads/<uuid>.png
[compose] insert that image into a block/HTML (src = /api/assets/<uuid>.png)
[send]    /api/send, once, right before sending:
            · reads the body's local images from disk → converts to base64 + CID attachment
            · replaces <img src> with cid:<id>  (lib/email-images.ts)
          → Resend embeds the images in the email and sends
```

**The only requirement:** a **persistent disk** so uploaded files are preserved.
- ✅ A regular server (VM / cloud instance / home server) — `data/` stays on disk, so it works
- ❌ Serverless (Vercel etc., ephemeral disk) — uploads are wiped on every deploy → use Path C in that case

**Constraints:** 40MB per email (images after base64), images re-sent to every recipient (inefficient at scale).

> This is the default (`provider:"local"`, `delivery:"attach"`). After cloning, images go out embedded in the email with no setup at all.

---

## Path B. `local` + `hosted` — The App Serves Its Own Images

The app itself **serves images over a public URL**. A bit more efficient for bulk without a separate bucket.

**What you need:**
1. The app must be live on a **public HTTPS domain** (e.g. `https://email-blast.yourbrand.com`)
2. A **persistent disk** (to preserve uploads)
3. `identity.appBaseUrl` in `brand.config.ts`, or `APP_BASE_URL` in `.env.local`, set to that public domain

**Pipeline:**
```
[upload]  /api/upload → data/uploads/<uuid>.png,  URL = {APP_BASE_URL}/api/assets/<uuid>.png
[send]    delivery=hosted, so the URL is left in the body as-is, no conversion
[open]    the recipient's email client loads https://yourapp/api/assets/<uuid>.png directly
          (that route is public — included in the middleware allowlist)
```

**Settings:**
```ts
assets: { provider: "local", delivery: "hosted", … }
```
```
# .env.local
APP_BASE_URL=https://email-blast.yourbrand.com
```

**Caution:** for images to stay alive, **the app must stay up** (if it goes down, images in past emails break).
Changing the domain/URL also breaks image links in past emails.

---

## Path C. Object Storage (R2/S3/Azure) + `hosted` — CDN, Bulk

Upload images to a dedicated bucket and serve them via CDN. Good for bulk, multi-server, and egress efficiency.

### C-1. Cloudflare R2 (recommended — 10GB free, 0 egress)

**(1) Create a bucket**
1. Cloudflare dashboard → **R2** → **Create bucket** → enter a name (e.g. `email-blast-assets`)

**(2) Enable public access** (email clients must load it without authentication)
- Simple: bucket **Settings → Public access → allow r2.dev subdomain** → get a `https://pub-xxxx.r2.dev` public URL
- Recommended: **connect a custom domain** (`images.yourbrand.com`) → R2 bucket Settings → Custom Domains

**(3) Issue an API token**
- R2 → **Manage R2 API Tokens** → **Create API token** → permission **Object Read & Write**
- Get the issued **Access Key ID**, **Secret Access Key**, and **Account ID** (top right of the dashboard)

**(4) Write the adapter** — `lib/storage/adapters/r2.ts` (S3-compatible):
```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import type { StorageAdapter } from "../types";

const PREFIX = "assets/email-blast";

export class R2Adapter implements StorageAdapter {
  readonly name = "r2";
  async put(data: Buffer, contentType: string, ext: string): Promise<string> {
    const accountId = process.env.R2_ACCOUNT_ID!;
    const bucket = process.env.R2_BUCKET!;
    const publicBase = process.env.R2_PUBLIC_BASE!.replace(/\/+$/, ""); // r2.dev or custom domain
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const key = `${PREFIX}/${randomUUID()}.${ext}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: data,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return `${publicBase}/${key}`;
  }
}
```

**(5) Install the package**
```bash
npm install @aws-sdk/client-s3
```

**(6) Register in the registry** — one line in `ADAPTERS` of `lib/storage/index.ts`:
```ts
import { R2Adapter } from "./adapters/r2";
const ADAPTERS = {
  local: () => new LocalAdapter(),
  azure: () => new AzureAdapter(),
  r2: () => new R2Adapter(),   // ← add
};
```

**(7) Settings + keys**
```ts
// brand.config.ts
assets: { provider: "r2", delivery: "hosted", … }
```
```
# .env.local
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=email-blast-assets
R2_PUBLIC_BASE=https://images.yourbrand.com   # or https://pub-xxxx.r2.dev
```

> ⚠️ The returned URL must be a **public URL that opens without authentication** (no signed URLs, no private buckets) —
> because the email client loads it without any token.

### C-2. AWS S3 — Same Pattern
From the R2 adapter above, drop `endpoint`, set `region` to your actual region, and rename the keys to `AWS_*`.
Make the bucket public-read (or front it with CloudFront) and point `S3_PUBLIC_BASE` at that URL.

### C-3. Azure Blob — Already Built In
The adapter (`lib/storage/adapters/azure.ts`) is included by default. Just set `provider:"azure"` and fill in
`AZURE_STORAGE_ACCOUNT/_KEY/_CONTAINER` in `.env.local` (the container must be public read).

---

## 3. Full Wiring Diagram (How Things Connect)

```
upload:
  UI → POST /api/upload → lib/storage(index.ts) → [provider adapter].put()
       → store + return public/local URL → insert that URL into the block spec/HTML

send:
  POST /api/send → buildFullHtml → (branch on brand.assets.delivery)
     ├ "attach": lib/email-images.inlineLocalImages()
     │           → local images to base64 + CID attachment, src→cid:  → Resend(attachments)
     └ "hosted": no conversion, URL as-is → Resend
```

- **Plugging in additional storage does not touch the call sites (`/api/upload`, `/api/send`)** — you only add an adapter.
- The delivery toggle branches only in the send path.

## 4. Common Notes

- **Image blocking**: some email clients block external images by default (until "show images" is clicked).
  CID inline images tend to show more reliably, but in either case avoid bodies that depend solely on images and
  include plenty of text (also better for deliverability).
- **Persistence**: the local variants are gone if the disk dies — consider backups or object storage.
- **Size**: attach is 40MB per email (after base64). Optimize images beforehand (resize/compress).

---

For the full setup procedure see [`docs/setup.md`](setup.md); for the white-label structure see [`docs/white-label.md`](white-label.md).
