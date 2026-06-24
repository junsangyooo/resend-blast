# SETUP — Getting Started

This is the full procedure for taking this repo and standing it up as **your own (company/personal) branded email sending tool**.
Only two files change: **`brand.config.ts` (public brand)** and **`.env.local` (secret keys)**.

```
brand.config.ts   ← company name, domains, colors, logo, auth mode  (values that are fine to expose)
.env.local        ← API keys, passwords, secrets                    (never commit)
```

> Why two files? `brand.config.ts` is used for rendering the UI and is **shipped to the browser** (public). So
> secret keys must never live there — they go in `.env.local`. This is a security principle and the two cannot be merged.

---

## 0. Prerequisites

| What you need | Used for | Optional? |
|---|---|---|
| **1 domain** | Sending address (`hello@send.example.com`) | ❌ Required (you can't pass sending verification with gmail.com, etc.) |
| **Resend account** | Sending email | ❌ Required |
| Node.js ≥ 18.17 | Running the app | ❌ Required |
| Image storage (Azure/R2/S3) | Uploading images into emails | ⬜ Skippable if you don't use images |
| Google Cloud project | Google login mode | ⬜ Not needed in password mode |

---

## 1. Clone & install

```bash
git clone <your-repo-url> && cd email-blast
npm install
cp brand.config.example.ts brand.config.ts
cp .env.local.example .env.local
```

`brand.config.ts` and `.env.local` are **gitignored** and never committed (yours only).

---

## 2. Fill in `brand.config.ts` (brand & design)

Changing just the **6 base values + design tokens** at the top of the file propagates to most of the app.

```ts
const COMPANY = "Acme";                       // Company/service name
const LEGAL_NAME = "Acme Inc.";               // Compliance footer sender name
const LOGIN_DOMAIN = "example.com";           // Allowed Google login domain (google mode only)
const SENDER_DOMAIN = "send.example.com";     // Sending domain (★must match your Resend verification)
const WEBSITE_URL = "https://www.example.com";// Footer logo click link
const ASSET_BASE = "https://cdn.example.com/assets"; // Public URL base for logos/icons
```

**Design colors** (email + app console share the same palette):

```ts
const PRIMARY     = "#5b5bf0";  // Accent color (links, buttons, highlights, app accent)
const PRIMARY_CTA = "#7c7cff";  // CTA button
const PRIMARY_DEEP= "#4a4ad6";  // Deep accent (app rail)
// ... TEXT_*, TINT_*, EMAIL_*, etc. are also split by semantic meaning
```

Other sections:

| Section | What |
|---|---|
| `senders.builtinFrom` | Sender (From) list (at least 1, matching senderDomain) |
| `senders.replyToDefault` | Default reply-to address (can be outside senderDomain, e.g. your own gmail) |
| `email.headerLogo` / `footerLogo` / `socialIcons` / `social` | Logos & social (leave a link empty to auto-hide that icon) |
| `assets.provider` | Image storage backend (`"azure"`, etc. — see section 4) |

---

## 3. Choosing the auth mode — `auth.mode`

Decided in **one line** in the `auth` section of `brand.config.ts`.

### (A) Password mode — fastest start (zero external dependencies)

```ts
auth: {
  mode: "password",
  operatorEmail: "you@example.com",  // Single operator = automatic admin (used for session & sender ownership)
  ...
}
```
And in `.env.local`:
```
ACCESS_PASSWORD=your_chosen_password
```
→ On first visit you get a password prompt. On a match you're logged in as the `operatorEmail` identity.
No Google setup required at all.

### (B) Google mode — Workspace domain login

```ts
auth: { mode: "google", loginDomain: "example.com", ... }
```
Requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.local` (how to get them: section 5-4).

> Switching is just one line on `mode`. Both implementations ship in the code.

---

## 4. Images — storage backend + delivery method

> **The full pipeline, infrastructure, and connection guide (building an R2/S3 bucket, writing an adapter, etc.)
> is in [`docs/IMAGES.md`](IMAGES.md).** Below is a summary.

Images are configured along **2 axes** (the `assets` section of `brand.config.ts`).

### 4-1. Storage backend `assets.provider` — where to store

**Default: `"local"`** — zero external accounts. Uploaded images are stored on the server disk (`data/uploads/`).
No extra setup needed.

**Alternative: `"azure"`** (object storage)
```
AZURE_STORAGE_ACCOUNT=
AZURE_STORAGE_KEY=          # az storage account keys list -n <account>
AZURE_STORAGE_CONTAINER=
```
For **Cloudflare R2 / AWS S3** etc., add an adapter (`lib/storage/adapters/<name>.ts`) and
register it in the `ADAPTERS` map of `lib/storage/index.ts` (details: `docs/WHITELABEL.md` section 3-1).

### 4-2. Delivery method `assets.delivery` — how to put images in the mail

**Default: `"attach"`** — at send time, local images are **CID-inlined as attachments** (`<img src="cid:…">`).
→ **No** external hosting or public URL needed. Ideal for personal/small sends.
Limit: 40MB after base64 per email. *Note: the image is re-sent to every recipient, so it's inefficient for bulk sends.*

**`"hosted"`** — references the image URL directly (the mail client loads it externally). Efficient for bulk.
But the app (local serving) or your storage must be reachable on a **public domain**.

> External CDN URLs (e.g. brand logos) stay hosted even in attach mode (only local uploads are attached).

---

## 5. Fill in `.env.local` (secret keys) — where to get them

### 5-1. Sending key (required) — Resend
1. Sign up at [resend.com](https://resend.com) → left sidebar **API Keys** → **Create API Key**
2. Create with **Full access** permission → copy the key
3. `.env.local`:
   ```
   RESEND_EMAIL_TRACKING_API_KEY=re_xxx
   ```

### 5-2. Session secret (required)
For signing JWT sessions. Generate in your terminal:
```bash
openssl rand -base64 32
```
```
AUTH_SESSION_SECRET=<the output above>
```

### 5-3. Password (when using password mode)
```
ACCESS_PASSWORD=your_chosen_password
```

### 5-4. Google OAuth (when using Google mode)
1. [Google Cloud Console](https://console.cloud.google.com) → create/select a project
2. Configure **APIs & Services → OAuth consent screen** (Internal recommended)
3. **Credentials → Create Credentials → OAuth client ID → Web application**
4. Add to **Authorized redirect URIs**:
   - `http://localhost:3001/api/auth/google/callback`
   - `https://<your-deploy-domain>/api/auth/google/callback`
5. The generated ID/secret:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### 5-5. Optional variables
```
ADMIN_EMAILS=a@x.com,b@x.com   # Additional admins (comma-separated)
APP_BASE_URL=https://...       # Base for unsubscribe links (deploy domain)
SENDER_ORG_NAME=               # Compliance sender name (default = brand.config legalName)
SENDER_POSTAL_ADDRESS=         # ⚠️ Legal requirement for external sends (physical address)
SENDER_CONTACT_EMAIL=          # Unsubscribe mailto
RESEND_WEBHOOK_SECRET=         # Resend webhook signature verification (only if used)
```

---

## 6. Sending domain verification (★the key to deliverability — skip it and you'll be flagged/rejected as spam)

1. [Resend](https://resend.com) → **Domains → Add Domain** → enter your sending domain
   (a subdomain is recommended: `send.example.com` — protects your root domain's reputation)
2. Register the **SPF · DKIM (· DMARC)** DNS records Resend gives you in your domain's DNS
   (the DNS menu of your domain management console, e.g. Cloudflare)
3. Confirm **Verified** in Resend
4. Verify that `SENDER_DOMAIN` and `builtinFrom` in `brand.config.ts` match this domain

### (Optional) Receiving replies
The sending domain is send-only. To receive replies, set up **inbound routing** separately:
- e.g. **Cloudflare Email Routing** (free): forward `inquiry@example.com` → your own inbox
- Set `replyToDefault` in `brand.config` to that address

---

## 7. First run & verification

```bash
npm run dev      # http://localhost:3001
```
- If the login screen (password or Google) appears, your auth setup is correct
- Create a list → create a template (email) → send a test to yourself
- Confirm `npm test` passes

---

## 8. Deployment (overview)

This is a standard Next.js app. Deploy anywhere:
- **Node server** (VM/cloud instance) + reverse proxy (Caddy/Nginx, automatic HTTPS)
- Or a container/PaaS

Key checks:
1. Put `.env.local` (or environment variables) and `brand.config.ts` on the deploy server (both are gitignored, so transfer them separately)
2. `npm run build && npm start`
3. Point your deploy domain → server with a DNS A record, and issue an HTTPS certificate
4. In Google mode, add the deploy domain to the OAuth redirect URIs (section 5-4)
5. Complete the sending domain verification in section 6

---

## 9. Setup checklist

- [ ] `npm install`
- [ ] `cp brand.config.example.ts brand.config.ts` → replace base values & design tokens
- [ ] `cp .env.local.example .env.local`
- [ ] Choose `auth.mode` (password → `ACCESS_PASSWORD`, google → `GOOGLE_CLIENT_*`)
- [ ] `RESEND_EMAIL_TRACKING_API_KEY` (5-1)
- [ ] `AUTH_SESSION_SECRET` (5-2)
- [ ] (if using images) storage provider + keys (section 4)
- [ ] **Sending domain SPF/DKIM verification** (section 6) ← skip it and mail gets flagged/rejected as spam
- [ ] `SENDER_POSTAL_ADDRESS` (legal requirement for external sends)
- [ ] `npm test` → `npm run build` → deploy
