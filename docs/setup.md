# Setup

End-to-end setup for running this project as your own branded email tool. Only two files change:
**`brand.config.ts`** (public brand) and **`.env.local`** (secret keys).

## Prerequisites

| Requirement | Why | Optional? |
|---|---|---|
| **Resend account** | Sending email — the only mandatory provider | ❌ Required |
| **A domain you own** | Verified sending address (`hello@send.yourbrand.com`) | ❌ Required ([why](resend.md)) |
| Node.js ≥ 18.17 | Running the app | ❌ Required |
| Object storage (R2/S3/Azure) | Only for `hosted` image delivery at scale | ⬜ Optional (default is local + attach) |
| Google Cloud project | Only for Google login mode | ⬜ Optional (password mode needs none) |

## Quick start

```bash
git clone <your-repo-url> && cd resend-blast
npm install

cp brand.config.example.ts brand.config.ts   # public brand config
cp .env.local.example .env.local              # secret keys

npm run dev      # http://localhost:3001
```

## Steps

### 1. Resend + domain
Create a Resend account, get an API key, and **verify your sending domain** (SPF/DKIM).
→ Full walkthrough: **[`resend.md`](resend.md)**. Put the key in `.env.local`:
```
RESEND_EMAIL_TRACKING_API_KEY=re_xxxxxxxx
```

### 2. Brand config
Edit `brand.config.ts` — company name, domains, design tokens, senders, and `auth.mode`.
→ Field reference: **[`brand-config.md`](brand-config.md)**.

### 3. Secret keys (`.env.local`)

| Variable | Required | Notes |
|---|---|---|
| `RESEND_EMAIL_TRACKING_API_KEY` | ✅ | Sending + tracking (see [`resend.md`](resend.md)) |
| `AUTH_SESSION_SECRET` | ✅ | Session signing — `openssl rand -base64 32` |
| `ACCESS_PASSWORD` | password mode | The login password |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | google mode | See "Google OAuth" below |
| `AZURE_STORAGE_*` / `R2_*` | hosted images only | See [`images.md`](images.md) |
| `ADMIN_EMAILS` | optional | Extra admins (comma-separated) |
| `APP_BASE_URL` | optional | Unsubscribe-link base (deploy domain) |
| `SENDER_POSTAL_ADDRESS` | external sends | ⚠️ legal requirement (physical address) |
| `SENDER_ORG_NAME` / `SENDER_CONTACT_EMAIL` | optional | Compliance footer overrides |
| `RESEND_WEBHOOK_SECRET` | optional | Persist open/click/bounce ([`resend.md`](resend.md)) |

**Google OAuth** (google mode only): in the [Google Cloud Console](https://console.cloud.google.com),
create an OAuth web client and add these Authorized redirect URIs:
- `http://localhost:3001/api/auth/google/callback`
- `https://<your-deploy-domain>/api/auth/google/callback`

### 4. Images (optional)
Default is `local` storage + `attach` delivery — images are embedded in emails with **no external
setup**. For high-volume/CDN delivery, switch to `hosted` + object storage.
→ **[`images.md`](images.md)**.

### 5. Run & verify
```bash
npm run dev      # http://localhost:3001 — login screen confirms auth is set up
npm test         # vitest
npm run build    # production build
```
Create a list → create an email → send a test to yourself.

### 6. Deploy
Standard Next.js app — deploy to any Node host behind a reverse proxy (Caddy/Nginx for automatic
HTTPS), or a container/PaaS.

1. Place `.env.local` and `brand.config.ts` on the server (both gitignored — transfer separately).
2. `npm run build && npm start`.
3. Point your domain to the server (DNS A record) and issue HTTPS.
4. Google mode: add the deploy domain to the OAuth redirect URIs.
5. Complete domain verification in Resend ([`resend.md`](resend.md)).

See [`production.md`](production.md) for security and pre-deploy hardening.

## Checklist

- [ ] `npm install`
- [ ] `cp brand.config.example.ts brand.config.ts` → edit base values & design tokens
- [ ] `cp .env.local.example .env.local`
- [ ] Resend API key + **domain verified** ([`resend.md`](resend.md))
- [ ] `AUTH_SESSION_SECRET`
- [ ] `auth.mode` → `ACCESS_PASSWORD` (password) or `GOOGLE_CLIENT_*` (google)
- [ ] `SENDER_POSTAL_ADDRESS` (external sends)
- [ ] `npm test` → `npm run build` → deploy
