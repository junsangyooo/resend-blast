# Resend Guide

This project sends all email through **[Resend](https://resend.com)**. To send to real recipients,
Resend requires you to **own and verify a domain** — this is the single hard external requirement of
the project. This guide walks through the Resend account, the API key, domain verification, sender
addresses, replies, tracking, and webhooks.

> **Why a domain is required.** Resend will only send "From" a domain you have verified (by adding
> DKIM records you control). You cannot verify a domain you don't own (e.g. `gmail.com`), so you
> **cannot send from `you@gmail.com`**. A Gmail address can still be a *recipient*, a *Reply-To*, or
> the app's *operator/admin* identity — but not the sending address.

---

## 1. Create an account and API key

1. Sign up at [resend.com](https://resend.com).
2. Left sidebar → **API Keys** → **Create API Key**.
3. Give it **Full access** (the app uses one key for sending, tracking, and live status lookups).
4. Copy the key (`re_...`) into `.env.local`:
   ```
   RESEND_EMAIL_TRACKING_API_KEY=re_xxxxxxxx
   ```

---

## 2. Register and verify your sending domain ★

You need a domain you control. **Any registrar works** — Namecheap, Cloudflare, GoDaddy, Porkbun,
Google Domains, etc. Resend does not care where you bought it; what matters is that you can edit the
domain's **DNS records**.

1. In Resend → **Domains → Add Domain**.
2. Enter your sending domain. **Use a subdomain** such as `send.yourbrand.com` (recommended — it
   isolates bulk-send reputation from your root domain).
3. Resend shows a set of DNS records — typically **SPF**, **DKIM**, and (optionally) **DMARC**.
   Add each record in your domain's DNS console (wherever your domain's DNS is managed).
4. Back in Resend, wait for the status to become **Verified**.
5. Make sure `brand.config.ts` matches the verified domain:
   - `SENDER_DOMAIN` = the verified domain (e.g. `send.yourbrand.com`)
   - `senders.builtinFrom` addresses are on that domain (e.g. `hello@send.yourbrand.com`)

> ⚠️ **Skipping verification breaks deliverability.** Without SPF/DKIM, Gmail/Outlook will reject or
> spam-folder your mail. This step is not optional for real sending.

### Testing without a domain (optional)
Resend provides a shared test sender (`onboarding@resend.dev`) that can send **only to your own
verified email**, for quick testing before your domain is ready. It is not usable for real
recipients — a verified domain is still required for production.

---

## 3. Sender (From) addresses

Once a domain is verified, you can send **From any address on that domain** — the address does **not**
need to be a real mailbox. For example, with `send.yourbrand.com` verified, all of these are valid
From addresses: `hello@`, `news@`, `no-reply@`, etc.

Configure them in `brand.config.ts` → `senders.builtinFrom`. Operators can also add more senders at
runtime via the app UI (stored in `data/from.json`). See [`brand-config.md`](brand-config.md).

---

## 4. Sending vs. receiving (important)

**Resend is send-only.** It delivers outbound mail; it does **not** receive replies.

- **Sending** `From: news@yourbrand.com` → **Resend** (after domain verification).
- **Receiving** a reply at `you@yourbrand.com` → handled by **that domain's mailbox / inbound mail
  host**, not Resend.

So decide where replies should land and set it as the **Reply-To**:

- If you already have a mailbox on the domain (Google Workspace, Zoho, your registrar's email
  hosting, …), set `replyToDefault` to that address and replies arrive there normally.
- If you have **no mailbox**, use an inbound forwarder such as **Cloudflare Email Routing** (free) to
  forward `inquiry@yourbrand.com` → your personal inbox, then set that as `replyToDefault`.

Set the default reply address in `brand.config.ts` → `senders.replyToDefault` (it may be outside the
sending domain, e.g. your Gmail). If you send from a no-mailbox address and set no Reply-To, replies
will bounce — so always point Reply-To at a real inbox.

---

## 5. Open / click tracking

In Resend → your domain's settings, enable **open** and **click** tracking. Without it, message
status stays at `delivered` and never advances to `opened`/`clicked`.

---

## 6. Webhooks (optional but recommended)

Resend retains event history for a limited window. To **persist** open/click/bounce/complaint events
(and auto-suppress bounces/complaints), register a webhook:

1. Resend → **Webhooks** → add endpoint `https://<your-deploy-domain>/api/webhooks/resend`.
2. Subscribe to `email.*` events.
3. Copy the **Signing Secret** into `.env.local`:
   ```
   RESEND_WEBHOOK_SECRET=whsec_xxxxxxxx
   ```

Without the webhook, the app still works via polling, but historical open/click/bounce data is not
persisted long-term.

---

## 7. Rate limits

Resend's default rate limit is a few messages per second. The app throttles sends to stay within it.
For frequent bulk sending, request a higher limit from Resend support, and tune
`SEND_MIN_GAP_MS` / the per-user limits via environment variables (see [`setup.md`](setup.md)).

---

Next: configure the app in [`brand-config.md`](brand-config.md), or see the full flow in
[`setup.md`](setup.md).
