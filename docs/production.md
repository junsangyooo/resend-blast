# Production & Security Notes

This document describes **what the product provides** out of the box and **what the operator must do before deploying**. It covers the built-in security, compliance, and tracking features, followed by a pre-deploy checklist.

All tests pass via `npm test`, and the project builds cleanly with `npm run build` and `npx tsc --noEmit`.

---

## 1. What the product provides

### Security

- **Stored-XSS protection**: HTML-serving routes (e.g. `/api/templates?preview=`) set `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff`, so even when opened in a new tab or downloaded, scripts cannot execute. (`app/api/templates/route.ts`)
- **Global security headers**: `next.config.js` sets nosniff, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, HSTS, and `Permissions-Policy`.
- **Ownership permission model**: editing/deleting lists and templates is restricted to **the creator or an admin (`ADMIN_EMAILS`)**. Legacy records with no recorded creator are left unlocked. (`canManage` in `lib/config.ts`, plus `lib/lists.ts`, `lib/templates.ts`, and each route.)
- **Authenticated import route**: list import verifies the actor, checks ownership, and caps imports at 50,000 members. (`app/api/lists/[slug]/import/route.ts`)
- **Send abuse limits**: per-send recipient cap (`MAX_RECIPIENTS_PER_SEND`, default 1000), per-user hourly and daily send limits, and a **global send throttle** (concurrent sends stay under the Resend rate limit), with a minimum gap between sends. (`app/api/send/route.ts`, `lib/send-guards.ts`, `lib/config.ts`)
- **Idempotency**: an identical send (same sender + subject + recipient set) within a short window is rejected, preventing accidental double-sends. (`lib/send-guards.ts`)
- **Input size guards**: template blocks ≤ 100, imports ≤ 50,000 rows.

### Compliance / deliverability

- **Unsubscribe**: each send injects `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click) headers and a signed unsubscribe link in the body footer. A public route `/api/unsubscribe` (GET confirmation page → POST processing) records the address in the suppression list. (`lib/unsubscribe.ts`, `app/api/unsubscribe/route.ts`, `lib/blocks.ts`)
- **Suppression list**: unsubscribed, bounced, and spam-complaint addresses are stored in `data/suppression.json` and **automatically excluded from the next send**. Resend webhook `bounced`/`complained` events register automatically. (`lib/suppression.ts`)
- **Ad-mail labeling**: when an email is flagged as advertising/marketing on the send screen, a label is automatically prefixed to the subject, and the footer shows the sender's name, contact, and unsubscribe method.
- **Sender postal address (CAN-SPAM)**: optional sender physical postal address (`SENDER_POSTAL_ADDRESS`) shown in the footer, for jurisdictions that require it.
- **Outlook-safe rendering**: `rgba()` colors are flattened to hex composited over white, buttons/badges carry a `bgcolor` attribute, and the copyright year is dynamic (`new Date().getFullYear()`).

### Tracking / follow-up

- **Resend webhook**: `/api/webhooks/resend` (Svix signature verification) persists open/click/bounce/complaint events onto the send record (working around Resend's ~30-day retention) and auto-suppresses bounces/complaints. (`app/api/webhooks/resend/route.ts`)
- **Persisted live status**: statuses fetched via live "check Resend status" are also stored on the record.
- **Metrics**: the detail modal shows sent/delivered/open rate/click rate plus bounce and spam-complaint counts. (`computeMetrics` in `lib/send-log.ts`)
- **Follow-up actions**: from the detail modal, **"resend to failed" / "remind unopened"** prefill the target addresses into the send screen, plus **CSV export** and copy buttons for failed/all recipients. (`components/TrackingSidebar.tsx`, `app/page.tsx`)

### Self-service flexibility

- **Multiple senders**: built-in plus custom senders in `data/from.json` (added by an admin via UI/API). The send screen offers sender selection plus a **Reply-To** input. (`lib/senders.ts`, `app/api/from/route.ts`, `app/api/config/route.ts`, `components/SendForm.tsx`)
- **Personalization**: `{{name}}` / `{{email}}` tokens in the body are substituted per recipient (values are also HTML-escaped). (`lib/blocks.ts`)
- **Footer options**: social icons on/off, editable sender name and address. (`components/TemplateComposer.tsx`)

### Operations / reliability

- **Test send**: a "send to me" button lets the operator inspect the real email in their own inbox before a live send.
- **Abort send**: an in-flight send can be stopped (the server loop checks an abort flag per recipient). (`app/api/sends/[id]/route.ts` PATCH)
- **Confirmation modal**: real rendered preview (iframe) + large-audience warning + ad-label/Reply-To summary.
- **Health check**: `/api/health` (public); the deploy script verifies a 200 after deploy.
- **Concurrency**: registry writes are atomic + locked. Stale-send cleanup cutoff scales with recipient count.
- **Pinned Node**: `.nvmrc` + `package.json` engines.

---

## 2. Pre-deploy checklist

### 2-1. Environment variables

Set these in your secrets store and deploy them as `.env.local` (or your platform's env config). Note: `brand.config.ts` is gitignored — generate it per-deploy via `npm run init` for your public brand identity (company name, domain, sender, logo, colors, UI strings). Secrets stay in env vars.

| Variable | Required? | Description |
|---|---|---|
| `RESEND_EMAIL_TRACKING_API_KEY` | yes | Resend API key used for sending and tracking. |
| `ADMIN_EMAILS` | recommended | Admin emails (comma-separated). Grants permission to edit/delete others' lists and templates, and to manage senders and the suppression list. e.g. `admin@example.com` |
| `AUTH_SESSION_SECRET` | yes | Secret used to sign session JWTs. Required in production (the app throws on startup if missing). |
| `ACCESS_PASSWORD` | one of two auth modes | Enables simple shared-password login. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | one of two auth modes | Enables Google OAuth login (domain-restricted). Use either password mode or Google mode. |
| `APP_BASE_URL` | optional | Base URL for unsubscribe links, e.g. `https://mail.example.com`. Falls back to brand config. |
| `RESEND_WEBHOOK_SECRET` | recommended | Resend webhook signing secret (`whsec_…`). Without it, open/click/bounce events are **not persisted** (polling only). |
| `SENDER_POSTAL_ADDRESS` | for external/cross-border sends | Sender physical postal address (CAN-SPAM). Omitted from footer if unset. |
| `SENDER_ORG_NAME` | optional | Sender organization name shown in the footer. |
| `SENDER_CONTACT_EMAIL` | optional | Unsubscribe `mailto:` address. |
| `MAX_RECIPIENTS_PER_SEND` / `USER_DAILY_SEND_LIMIT` / `USER_HOURLY_SEND_LIMIT` / `SEND_MIN_GAP_MS` | optional | Tune send caps and pacing. Defaults are conservative. |

### 2-2. Resend dashboard

1. **Verify the sending domain**: register and verify **SPF, DKIM, and DMARC** DNS records for your sending domain (or subdomain). *Without this, Gmail/Outlook will reject or spam-folder your mail (deliverability collapses).*
2. **Register the webhook**: endpoint `https://<your-domain>/api/webhooks/resend`, subscribe to `email.*` events → **copy the Signing Secret into `RESEND_WEBHOOK_SECRET`**.
3. **Enable open/click tracking**: turn on open and click tracking in domain settings (otherwise status stays at `delivered`).
4. **(If needed) Request a higher rate limit**: the default per-second limit is low. For frequent bulk sends, ask Resend support to raise it.
5. **Verify every sender address**: every `from` address added via the UI must be a **verified address/domain** in Resend for sends to succeed.

### 2-3. Operations infrastructure

1. **External monitoring**: watch `https://<your-domain>/api/health` with an uptime monitor (e.g. UptimeRobot, healthchecks.io) and alert on downtime.
2. **Data backup**: the `data/` directory (lists, sends, suppression, senders, admins, logos) is the operational source of truth. Back it up regularly to a separate machine or object store — e.g. a scheduled `rsync`/snapshot to another host, or periodic commit+push of `data/` to a private repo. The application guards against in-deploy data-loss races, but disk failure requires an independent backup.

### 2-4. Legal / consent (external sends)

External recipients (event invitations, promotions) generally require **prior consent** under applicable anti-spam law in your jurisdiction. Without a consent basis, hold the send or get legal review. The ad-label checkbox handles labeling and unsubscribe automatically, but **obtaining consent itself is the operator's responsibility**.

---

## 3. Post-deploy recommendations

- Existing templates can be **re-saved once in the block editor** so the new compliance footer (unsubscribe link) is embedded in the body. (Even before re-saving, the `List-Unsubscribe` header is injected automatically, so Gmail's one-click unsubscribe works.)
- Optional follow-ups: first-run onboarding (empty-state guidance), template/list search and sort, and modal accessibility (focus trap).

---

## 4. Intentionally deferred

| Item | Reason / alternative |
|---|---|
| Immediate session revocation (jti) | Middleware runs on the Edge runtime, so file-based revocation lookups aren't possible. Sessions use a fixed expiry. If a session is compromised, rotate `AUTH_SESSION_SECRET` (forces everyone to re-login). |
| Attachments | Supported by Resend, but upload/size/security surface is large; split into a separate phase. |
| Outlook VML button fallback | Risky to author without real-device testing. Current table + hex + bgcolor approach keeps buttons from breaking. Test in Outlook before sending. |
| Raw-HTML sanitizer library | Instead of adding a dependency, CSP sandbox blocks execution (equivalent effect, zero dependencies). |
| Send-log retention policy / pagination | Low volume today. Introduce as records accumulate. |

---

## 5. Architecture reference (key files)

```
lib/senders.ts                    sender registry (built-in + custom)
lib/suppression.ts                unsubscribe/bounce suppression list
lib/unsubscribe.ts                signed unsubscribe tokens
lib/send-guards.ts                content hash (idempotency) + global throttle
app/api/from/route.ts             sender management (admin)
app/api/health/route.ts           health check (public)
app/api/unsubscribe/route.ts      unsubscribe (public)
app/api/suppression/route.ts      suppression list query / removal
app/api/webhooks/resend/route.ts  Resend webhook receiver (signature-verified)
.nvmrc                            Node version pin
lib/*.test.ts                     unsubscribe / send-guards / config tests
```
