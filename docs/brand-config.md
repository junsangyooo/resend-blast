# Brand Config Guide

`brand.config.ts` is the **single source of truth** for everything brand-, design-, and auth-related.
Change this one file (plus secrets in `.env.local`) and the entire app — UI and emails — switches to
your brand. No code changes.

```
brand.config.ts   ← public brand identity, design, auth mode   (safe to expose; shipped to the browser)
.env.local        ← API keys, passwords, secrets                (never committed)
```

> The file is **gitignored** — generated per-deploy by `npm run init`. Set up with:
> ```bash
> npm run init     # interactive wizard generates brand.config.ts + .env.local
> ```

---

## 1. Base values (top of the file)

Changing these constants propagates across UI copy, emails, and senders.

```ts
const COMPANY      = "Acme";                          // display name (header, titles, footer)
const LEGAL_NAME   = "Acme Inc.";                     // legal sender name (compliance footer)
const LOGIN_DOMAIN = "example.com";                   // allowed Google-login domain (google mode only)
const SENDER_DOMAIN= "send.example.com";              // allowed sending (From) domain — must match Resend
const WEBSITE_URL  = "https://www.example.com";       // footer logo link
const ASSET_BASE   = "https://cdn.example.com/assets";// public base URL for hosted logos/icons
```

---

## 2. Design tokens (one place controls email + app UI)

Semantic color constants drive **both** the email renderer (`lib/blocks.ts`) and the app console UI
(injected as CSS variables by `app/layout.tsx`). Change them once; everything follows.

```ts
const PRIMARY      = "#5b5bf0";  // accent — links, kicker, numbers, stats, app accent
const PRIMARY_CTA  = "#7c7cff";  // CTA button background
const PRIMARY_DEEP = "#4a4ad6";  // deep accent — app left rail, hover
const TEXT_HEADING = "#0f0f1a";
const TEXT_BODY    = "#4a4a55";
// … TEXT_SUB, TEXT_MUTED, HAIRLINE, CARD_BORDER, TINT_*, EMAIL_* …
```

> Don't rename the keys under `email.colors` (`teal`/`mint`/…) — the renderer references them. Only
> change the token **values** above; the keys derive from them.

---

## 3. Auth — `auth` section

One line picks the login method. Both implementations ship in the code.

```ts
auth: {
  mode: "password",                 // "password" | "google"
  operatorEmail: "you@example.com", // password mode: single operator = automatic admin
  operatorName: "Acme",             // display name for the operator's sender
  loginDomain: LOGIN_DOMAIN,        // google mode: allowed Workspace domain
  senderDomain: SENDER_DOMAIN,      // allowed From domain
}
```

- **`password`** — a single password gate. The password value goes in `.env.local` as
  `ACCESS_PASSWORD`. Zero external dependencies; fastest to start.
- **`google`** — Google Workspace login restricted to `loginDomain`. Requires `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` (see [`setup.md`](setup.md)).

---

## 4. Senders & compliance — `senders` section

```ts
senders: {
  builtinFrom: [
    { value: `${COMPANY} <hello@${SENDER_DOMAIN}>`, label: COMPANY, builtin: true },
  ],
  replyToDefault: "inquiry@example.com", // may be outside senderDomain (e.g. your Gmail)
  orgName:        LEGAL_NAME,            // compliance footer (env SENDER_ORG_NAME overrides)
  postalAddress:  "",                    // ⚠️ required for external sends (env SENDER_POSTAL_ADDRESS)
  contactEmail:   "inquiry@example.com", // unsubscribe mailto (env SENDER_CONTACT_EMAIL)
}
```

- `builtinFrom` needs **at least one** entry, on `SENDER_DOMAIN`.
- `replyToDefault` is where replies land — point it at a **real inbox** (see [`resend.md`](resend.md)
  for sending-vs-receiving).
- Fill `postalAddress` before sending externally (CAN-SPAM / local anti-spam law).

---

## 5. Email appearance — `email` section

```ts
email: {
  colors:     { … },        // derived from the design tokens (section 2)
  surfaces:   { … },        // email page background / card colors
  headerLogo: { url, alt, width },
  footerLogo: { url, alt, link, width, height },
  socialIcons:{ x, linkedin, youtube },
  social:     { x: "", linkedin: "", youtube: "" }, // empty link → icon auto-hidden
}
```

Logos and icons must be **public URLs** (or use the local image pipeline). To embed images without
external hosting, see [`images.md`](images.md).

---

## 6. Images — `assets` section

Two independent axes (full guide: [`images.md`](images.md)):

```ts
assets: {
  provider: "local",   // where images are stored: local (disk) | azure | r2 | …
  delivery: "attach",  // how images reach the mail: attach (CID inline) | hosted (public URL)
  base: ASSET_BASE,
}
```

- Default `local` + `attach` = **zero external storage**; images are embedded in the email at send time.
- Switch to `hosted` + an object-storage `provider` for high-volume/CDN delivery.

---

## 7. UI text & templates

```ts
ui:        { headerBrand, footerWordmark, login: { … } }, // app console copy + login screen strings
templates: { defaultSubject },                            // default subject for new emails
```

---

## Where things live

| Concern | File |
|---|---|
| Public brand, design, auth mode | `brand.config.ts` (this file) |
| Secret keys / passwords | `.env.local` |
| Sending provider (Resend) + domain | [`resend.md`](resend.md) |
| Image storage & delivery | [`images.md`](images.md) |
| Overall setup flow | [`setup.md`](setup.md) |
| White-label internals | [`white-label.md`](white-label.md) |
