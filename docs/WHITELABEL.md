# WHITELABEL — Rebranding for Your Company or Personal Use

This project has a **white-label** structure. All company-specific values (brand, domain, logos, colors)
live in one place (`brand.config.ts`), and secrets (API keys) live only in `.env.local`.
**Change just these two things** and it works identically for any company or individual.

> Verified: even when you swap the domain, company name, and colors in `brand.config.ts` for
> placeholder values (e.g. `acme.io`), the type check and the full test suite pass unchanged.
> There is no company-specific value hardcoded in the code itself.

---

## 0. Core principle — what lives where

| Nature | Location | Examples | Git |
|---|---|---|---|
| **Secret** | `.env.local` | API keys, tokens, session secret | Not committed (`.gitignore`) |
| **Brand (public identity)** | `brand.config.ts` | Company name, domain, logo URLs, colors, UI copy | Committed (see "Git operation" below) |
| **Operational data** | `data/`, `templates/` | Lists, send logs, templates | Whitelist backup |

⚠️ **Never put secrets in `brand.config.ts`.** This file may be included in the
client bundle (only values that are safe to be public). All keys go in `.env.local`.

---

## 1. `.env.local` — provisioning keys (secrets)

Fill these into the project root `.env.local`. Only the names are listed here; provision the values yourself.

| Variable | Required | Purpose | Where to get it |
|---|:---:|---|---|
| `RESEND_EMAIL_TRACKING_API_KEY` | ✅ | Sending + tracking (full access) | [resend.com](https://resend.com) → API Keys → Create (full access) |
| `AZURE_STORAGE_ACCOUNT` | ⬜ | Image upload account name (only if `assets.provider: "azure"`) | Azure Portal → Storage account |
| `AZURE_STORAGE_KEY` | ⬜ | Access key for the account above | `az storage account keys list -n <account>` |
| `AZURE_STORAGE_CONTAINER` | ⬜ | Container name | Azure → Containers |
| `ACCESS_PASSWORD` | ⬜ | Single-password gate (only in `auth.mode: "password"`) | Choose your own |
| `GOOGLE_CLIENT_ID` | ⬜ | OAuth client (only in `auth.mode: "google"`) | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | ⬜ | OAuth secret (only in `auth.mode: "google"`) | Same place |
| `AUTH_SESSION_SECRET` | ✅ | Session JWT signing (= `JWT_SECRET`) | Generate with `openssl rand -base64 32` |
| `ADMIN_EMAILS` | ⬜ | Admin emails (comma-separated). Can manage others' lists, templates, senders | Set yourself |
| `APP_BASE_URL` | ⬜ | Public app URL (unsubscribe link base). Defaults to `brand.config`'s `appBaseUrl` | Deploy domain |
| `SENDER_ORG_NAME` | ⬜ | Compliance sender name. Defaults to `brand.config`'s `legalName` | — |
| `SENDER_POSTAL_ADDRESS` | ⚠️ | Sender physical address (CAN-SPAM requirement). Omitted from footer if blank | **Required before external sends** |
| `SENDER_CONTACT_EMAIL` | ⬜ | Unsubscribe mailto address. Defaults to `brand.config`'s `contactEmail` | — |
| `RESEND_WEBHOOK_SECRET` | ⬜ | Resend webhook signature verification | Resend → Webhooks |

> **Note:** The sending key is `RESEND_EMAIL_TRACKING_API_KEY`. The login domain and the
> auth mode are configured in `brand.config.ts` (`auth.mode` / `auth.loginDomain`), not via env.
> The UI (client) renders these values, so depending on env would cause hydration mismatches.
> **Change the login domain and auth mode in `brand.config.ts`.**

---

## 2. `brand.config.ts` — brand (this one file is the core)

Change just the **derived base values** at the top of the file and most things propagate automatically:

```ts
const COMPANY = "Acme";                                // → company name in header, login, footer, presets
const LEGAL_NAME = "Acme Inc.";                        // → compliance footer sender name
const LOGIN_DOMAIN = "example.com";                    // → allowed Google Workspace login domain (google mode)
const SENDER_DOMAIN = "send.example.com";              // → allowed From/Reply-To domain (★key to send blocking)
const WEBSITE_URL = "https://www.example.com";         // → email footer logo link
const ASSET_BASE = "https://cdn.example.com/assets";   // → logo/icon hosting base
```

Just above those, the **design-token constants** (`PRIMARY`, `PRIMARY_CTA`, `PRIMARY_DEEP`, …) are the
single source for color: they feed **both** the email body colors (`lib/blocks.ts`) **and** the app console UI
(`app/layout.tsx` injects them as CSS variables). Change a color once here and it applies everywhere.

Then fine-tune per section:

| Section | What | When to change |
|---|---|---|
| `identity` | Company name, app title, homepage, app base URL | When the company changes |
| `auth.mode` | Login method: `"password"` or `"google"` | Pick one |
| `auth.operatorEmail` | Single operator identity (password mode) = auto-admin | In password mode |
| `auth.loginDomain` | Allowed login domain (google mode) | **Required** in google mode (otherwise you can't log in with your own accounts) |
| `auth.senderDomain` | Allowed sending domain | **Required** (otherwise sends from your own domain are blocked) |
| `senders.builtinFrom` | Default sender list | To your sending address |
| `senders.replyToDefault` | Default reply address | To your address |
| `email.colors` | Email body colors | Derived from the design tokens above |
| `email.headerLogo` / `footerLogo` | Email header/footer logos | To your logo URLs (→ section 3) |
| `email.socialIcons` / `social` | Footer social icons/links | To your social accounts. **Leave a link as an empty string to auto-hide that icon** |
| `logos` | Header logo selection list | To your logos |
| `templates.defaultSubject` | Default subject for new templates | — |
| `ui` | Login/header copy | Auto-generated from company name (usually no edit needed) |

---

## 3. Replacing logos and icons (assets)

Image delivery is controlled by `assets.delivery` in `brand.config.ts`:

- **`"attach"` (default)** — local images are inlined into the email as CID attachments. No external
  hosting or public URL required. Ideal for personal / small-volume sends (each recipient re-receives
  the image, so it's inefficient at scale; 40MB-per-email limit).
- **`"hosted"`** — image URLs are referenced directly (the mail client loads them externally).
  Efficient at scale, but the app (or storage) must be reachable on a public domain.

In `"hosted"` mode the images **must** be served from a public URL (mail clients load them externally).
See [docs/IMAGES.md](./IMAGES.md) for the full image guide.

1. Prepare logo PNGs (header + footer) and social icons (X / LinkedIn / YouTube)
2. Upload to your storage and obtain public URLs
   - e.g. use the app's image upload feature (`/api/upload`) or your CDN's CLI
3. Update `ASSET_BASE` and `email.headerLogo.url` / `footerLogo.url` /
   `socialIcons.*` / `logos[].url` in `brand.config.ts` to the new URLs
4. If a logo's aspect ratio differs, adjust `width` (header) and `width`/`height` (footer)

### 3-1. Swapping the storage backend (local → S3 / R2 / Azure …)

The app uploads images at runtime (block-editor images, custom header logos).
**Where they get uploaded** is abstracted behind a storage adapter. The code itself
doesn't know the backend — only the entry point (`lib/storage/`) does.

```
lib/storage/
  types.ts              StorageAdapter interface (a single put())
  image-validation.ts   provider-agnostic shared validation (magic bytes, allowed formats, 5MB)
  index.ts              ★entry point. Selects the adapter via brand.config.assets.provider
  adapters/
    local.ts            Local disk adapter (default; app serves via /api/assets)
    azure.ts            Azure Blob adapter
```

**What lives where (asset storage)**

| Nature | Location | Examples |
|---|---|---|
| **Which backend** | `brand.config.ts` → `assets.provider` | `"local"` (default), `"azure"` |
| **Credentials (keys)** | `.env.local` | `AZURE_STORAGE_ACCOUNT` / `_KEY` / `_CONTAINER` |
| **Adapter implementation** | `lib/storage/adapters/<name>.ts` | upload logic |

**Using the default (`local`)** — nothing to change. `assets.provider: "local"` stores images on the
server disk and serves them through `/api/assets`. No external account or keys required.

**Switching to another storage — 4 steps**

1. **Write the adapter**: implement `StorageAdapter` in `lib/storage/adapters/<name>.ts`.
   `put(data, contentType, ext)` stores the buffer and returns a **public URL**.
   Read keys directly with `process.env` inside the adapter (don't put them in brand.config).

   ```ts
   // Example: Cloudflare R2 / AWS S3 (S3-compatible SDK)
   import type { StorageAdapter } from "../types";
   export class R2Adapter implements StorageAdapter {
     readonly name = "r2";
     async put(data: Buffer, contentType: string, ext: string): Promise<string> {
       const bucket = process.env.R2_BUCKET!;
       const publicBase = process.env.R2_PUBLIC_BASE!; // public URL base
       const key = `assets/email-blast/${crypto.randomUUID()}.${ext}`;
       // ...S3 PutObject (ContentType: contentType, CacheControl recommended)...
       return `${publicBase}/${key}`;
     }
   }
   ```

2. **Register it**: add one line to `ADAPTERS` in `lib/storage/index.ts`.

   ```ts
   const ADAPTERS = {
     local: () => new LocalAdapter(),
     azure: () => new AzureAdapter(),
     r2: () => new R2Adapter(),   // ← add
   };
   ```

3. **Flip the switch**: `brand.config.ts` → `assets.provider: "r2"`.

4. **Add keys**: put the storage keys (`R2_BUCKET`, `R2_PUBLIC_BASE`, access keys, …) in `.env.local`.

> Don't touch the callers (`app/api/upload`, `app/api/logos`) or the validation logic.
> If a provider name isn't in `ADAPTERS`, startup fails with a clear error.
>
> ⚠️ In `hosted` delivery the returned URL is **loaded externally by mail clients**, so it must be a
> public URL that opens without authentication (no signed URLs or private buckets). A cache header of
> `public, max-age=31536000, immutable` is recommended.

---

## 4. App UI colors

The app console's brand colors come from the design-token constants at the top of `brand.config.ts`
(`PRIMARY`, `PRIMARY_DEEP`, `PRIMARY_CTA`). `app/layout.tsx` injects them as `:root` CSS variables, so
the email and the app UI share the same palette from a single place:

```
--brand        /* accent (buttons, tabs, highlights) — from PRIMARY */
--brand-deep   /* deep accent / left rail — from PRIMARY_DEEP */
--brand-mint   /* CTA gradient bright end — from PRIMARY_CTA */
--rail         /* left vertical rail */
```

Change the design tokens once and both the email tone and the app UI update together — no separate
CSS edit needed.

---

## 5. External setup (DNS, OAuth, sending domain) — required before sending

Code and config alone aren't enough; you also need to register with external services.

### 5-1. Register the Google OAuth redirect URI (only in `auth.mode: "google"`)
1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click the OAuth 2.0 client ID you're using
3. Add the following to **Authorized redirect URIs**:
   - Local: `http://localhost:3001/api/auth/google/callback`
   - Deploy: `https://<deploy-domain>/api/auth/google/callback`
4. Save. (Client ID/secret go in `.env.local` as `GOOGLE_CLIENT_*`)

### 5-2. Sending domain verification (the key to deliverability)
1. [Resend](https://resend.com) → **Domains → Add Domain** → enter your sending domain
2. Add the **SPF, DKIM (and DMARC)** DNS records Resend gives you to your domain's DNS
3. Confirm **Verified** in Resend. *If skipped, Gmail/Outlook will reject or spam your mail → deliverability collapses*
4. `senders.builtinFrom` and `auth.senderDomain` in `brand.config.ts` must match this domain

### 5-3. (Optional) Webhook / monitoring
- **Webhook**: Resend → Webhooks → Endpoint `https://<domain>/api/webhooks/resend`,
  subscribe to `email.*` events → put the Signing Secret in `.env.local` as `RESEND_WEBHOOK_SECRET`
- **Health check**: monitor `https://<domain>/api/health` with UptimeRobot or similar

### 5-4. DNS A record
- Point the deploy domain to your server IP with an A record (e.g. a Caddy / self-hosted setup)

---

## 6. Git operation

`brand.config.ts` is **gitignored**; the committed template is `brand.config.example.ts`.
To set up, copy the template and edit your copy:

```bash
cp brand.config.example.ts brand.config.ts
```

Then edit `brand.config.ts` with your brand values. Because it's gitignored, your brand stays local
and never collides with upstream updates.

> (Note) If you later want to pull updates from the original source, add it as a remote
> (`git remote add upstream <repo>` → `git fetch/merge upstream`). Since your brand lives only in the
> gitignored `brand.config.ts`, upstream changes to `brand.config.example.ts` merge cleanly and your
> own config is untouched.

---

## 7. Migration checklist

- [ ] `cp brand.config.example.ts brand.config.ts`
- [ ] Fill in all your keys in `.env.local` (section 1)
- [ ] Replace the base values at the top of `brand.config.ts` (COMPANY, 2 domains, website, ASSET_BASE) and design tokens
- [ ] Choose `auth.mode` (`"password"` or `"google"`) and set the matching env/config
- [ ] Set `senders.builtinFrom` / `replyToDefault` to your sending address
- [ ] (If `assets.delivery: "hosted"`) upload logos/social icons and update the `email.*` URLs (section 3)
- [ ] Google OAuth redirect URI registered (5-1) — google mode only
- [ ] Sending domain SPF/DKIM verified (5-2) ← **skip this and your mail goes to spam / gets rejected**
- [ ] `SENDER_POSTAL_ADDRESS` filled in (legal requirement for external sends)
- [ ] Confirm `npm test` passes → `npm run build` → deploy
