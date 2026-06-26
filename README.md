# Resend Blast

A **white-label bulk email tool**. Non-developers build on-brand emails without writing HTML, send
them to many recipients through [Resend](https://resend.com), and track delivery — for event
invitations, reminders, newsletters, customer announcements, and more.

Stand up your own branded instance by editing **two files** — `brand.config.ts` (public brand) and
`.env.local` (secret keys). No code changes required.

---

## Requirements

This project is a **sending tool built on Resend**. Two things are mandatory and define its scope:

| Requirement | Why it's required |
|---|---|
| **A Resend account** | All email is sent through Resend. [Sign up free →](https://resend.com) |
| **A domain you own** | Resend only sends from a domain you verify (DKIM). Any registrar works. |
| Node.js ≥ 18.17 | Runtime. |

> **Scope / limitation.** You **cannot** send from a domainless address like `you@gmail.com` — Resend
> requires a verified domain you control. A Gmail address can still be a *recipient*, a *Reply-To*, or
> the app's *operator/admin* login, but not the sending address. See [`docs/resend.md`](docs/resend.md).

Optional, depending on configuration: object storage (only for `hosted` image delivery at scale), and
a Google Cloud OAuth client (only for Google login mode). Neither is needed for the defaults.

---

## Key features

- **Block composer** — Stack heading, paragraph, button, badge, numbered-list, agenda, grid, and image
  blocks. Colors, fonts, and spacing are locked by the design system, so emails are **always on-brand**.
- **Personalization** — `{{name}}` `{{firstName}}` `{{name|default}}` `{{email}}` substituted per
  recipient in both body and subject. Preview and live send share identical logic.
- **Recipient lists** — Import from CSV/Excel (automatic header matching) or paste free text. Send
  across multiple lists plus ad-hoc recipients at once.
- **Send + live tracking** — One-to-one delivery with per-message progress over an NDJSON stream;
  sending continues even if the client disconnects. Per-recipient status (delivered/opened/bounced…).
- **Compliance built in** — Signed unsubscribe links, an auto-applied suppression list, and a
  compliance footer (sender name, postal address, one-click unsubscribe headers).
- **Two auth modes** — One line in `brand.config`: **password** (single gate, zero dependencies) or
  **Google** Workspace login.
- **Flexible image delivery** — Inline **CID attachments** (no hosting) or **hosted URLs**, with
  pluggable storage (local disk / Azure / R2 / S3).
- **No database** — State lives in files (`data/`, `templates/`), keeping operations lightweight.

---

## What you can customize (no code changes)

| What | Where |
|---|---|
| Company name, app title, domains, website | `brand.config.ts` |
| Design colors (unified email + app palette) | `brand.config.ts` → design tokens |
| Logos, social icons, links | `brand.config.ts` |
| Sender (From), default Reply-To, compliance footer | `brand.config.ts` |
| Login method (password ↔ Google) | `brand.config.ts` → `auth.mode` |
| Image storage backend | `brand.config.ts` → `assets.provider` |
| Image delivery (attachment ↔ hosted) | `brand.config.ts` → `assets.delivery` |
| All secret keys | `.env.local` |

---

## Quick start

```bash
git clone <your-repo-url> && cd resend-blast
npm install
npm run init     # interactive wizard generates brand.config.ts + .env.local
npm run dev      # http://localhost:3001
npm test         # vitest
npm run build    # production build
```

---

## Documentation

| Guide | What it covers |
|---|---|
| **[docs/setup.md](docs/setup.md)** | Start here — end-to-end setup flow and checklist |
| [docs/resend.md](docs/resend.md) | Resend account, API key, **domain verification (SPF/DKIM)**, replies, webhooks |
| [docs/brand-config.md](docs/brand-config.md) | `brand.config.ts` field reference (identity, design, auth, senders) |
| [docs/images.md](docs/images.md) | Image pipeline — CID attach vs hosted, storage adapters, R2/S3 setup |
| [docs/white-label.md](docs/white-label.md) | White-label internals and how to rebrand cleanly |
| [docs/production.md](docs/production.md) | Production & security notes, pre-deploy checklist |

---

## Stack

- **Next.js 14 (App Router) · React 18 · TypeScript · Tailwind**
- Sending: **Resend** SDK
- Images: storage-adapter abstraction (local disk default; Azure / R2 / S3 swappable)
- Auth: password gate or Google OAuth + HS256 JWT session cookie
- Storage: file-based (`data/`, `templates/`) — no database

---

## Project structure

```
scripts/init/             init wizard (npm run init) — generates brand.config.ts + .env.local
app/                      pages + API routes (auth, send, lists, templates, upload, assets …)
components/               UI: send form, tracking, block composer, settings …
lib/                      blocks (email renderer), personalize, lists, senders, admins, storage, session …
templates/                generated emails (HTML + block spec)
data/                     lists, send logs, senders, admins, suppression (file storage)
docs/                     setup, resend, brand-config, images, white-label, production guides
```

---

## Notes

For internal/personal use. Before sending to external recipients you **must** set
`SENDER_POSTAL_ADDRESS` and verify your sending domain (SPF/DKIM) — otherwise mail may be spam-foldered
or violate anti-spam law. See [docs/setup.md](docs/setup.md) and [docs/resend.md](docs/resend.md).
