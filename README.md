# Email Blast

A **white-label bulk email tool** that lets non-developers **build on-brand emails without writing HTML**,
send them to many recipients, and track delivery status. Use it for event invitations, reminders,
newsletters, customer announcements, and more.

> Any company or individual gets it running with their own brand, account, and design by filling in
> just two files — **`brand.config.ts` (public brand) + `.env.local` (secret keys)**. No code changes required.

## Key features

- **Block composer** — Stack heading, paragraph, button, badge, numbered-list, agenda, grid, and image
  blocks to build an email. Colors, fonts, and spacing are locked by the design system, so emails are
  **always on-brand** (no arbitrary px or hex values).
- **Personalization** — Substitute `{{name}}` `{{firstName}}` `{{name|default}}` `{{email}}` per recipient
  (in both body and subject). Preview and live send use identical logic.
- **Recipient lists** — Import from CSV/Excel (automatic header matching) or paste free text. Send across
  multiple lists plus ad-hoc recipients in one go.
- **Send + progress tracking** — One-to-one delivery via Resend, with per-message progress over an NDJSON
  stream. If the client disconnects, sending continues and results are persisted to file.
- **Tracking** — Per-send cards plus live per-recipient status (delivered/opened/bounced…).
- **Unsubscribe / bounce management** — Signed unsubscribe links and an automatically applied suppression
  list (with a compliance footer).
- **Two auth modes** — Switch with one line in `brand.config`:
  - **Password mode** — Single password gate (zero external dependencies, fastest to start)
  - **Google mode** — Google Workspace domain login
- **No database** — State is stored as files (`data/`, `templates/`), keeping operations lightweight.

## What you can customize (without touching code)

| What | Where |
|---|---|
| Company name, app title, domain, website | `brand.config.ts` |
| **Design colors** (unified palette for email + app console) | `brand.config.ts` → design tokens |
| Logos, social icons, links | `brand.config.ts` |
| Sender (From), default Reply-To, compliance footer | `brand.config.ts` |
| **Login method** (password ↔ Google) | `brand.config.ts` → `auth.mode` |
| Image storage backend (**local** (default) / Azure / R2 …) | `brand.config.ts` → `assets.provider` + `.env.local` |
| **Image delivery mode** (CID attachment ↔ hosted URL) | `brand.config.ts` → `assets.delivery` |
| All secret keys | `.env.local` |

→ **First-time setup guide: [`docs/SETUP.md`](docs/SETUP.md)**. The image pipeline (attach/hosted and
bucket setup) is in [`docs/IMAGES.md`](docs/IMAGES.md), and the white-label structure is in
[`docs/WHITELABEL.md`](docs/WHITELABEL.md).

## Quick start

```bash
git clone <your-repo-url> && cd email-blast
npm install

cp brand.config.example.ts brand.config.ts   # brand config (public)
cp .env.local.example .env.local              # secret keys (private)
# → fill both files with your own values (see docs/SETUP.md)

npm run dev      # http://localhost:3001
npm test         # vitest (renderer, session, send guards)
npm run build    # production build
```

## Stack

- **Next.js 14 (App Router) + React 18 + TypeScript + Tailwind**
- Sending: **Resend** SDK
- Images: storage adapter abstraction (default local disk; swappable for Azure Blob, R2/S3, etc.)
- Auth: password gate or Google OAuth + HS256 JWT session cookie
- Storage: file-based (`data/`, `templates/`) — no separate database

## Structure (overview)

```
brand.config.ts        ★ single config for brand, design, and auth mode (gitignored — copied from the example)
brand.config.example.ts  committed template for the file above
.env.local.example     secret keys template
app/                   pages + API routes (auth, send, lists, templates, upload …)
components/            UI: send form, tracking, block composer, settings, etc.
lib/                   blocks (renderer), personalize, lists, send-log, senders, admins, storage, session …
templates/             generated emails (HTML + block spec)
data/                  lists, send logs, senders, admins, suppression (file storage)
docs/SETUP.md          ★ setup guide for first-time users
docs/WHITELABEL.md     white-label structure and migration guide
```

## License

Internal/personal use. Before sending externally, you must set the sender postal address
(`SENDER_POSTAL_ADDRESS`) and authenticate your sending domain (SPF/DKIM) — otherwise mail may be
flagged as spam or violate legal requirements (see SETUP.md for details).
