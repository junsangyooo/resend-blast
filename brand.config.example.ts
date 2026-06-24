/**
 * ────────────────────────────────────────────────────────────────────────────
 *  BRAND CONFIG — white-label single source of truth
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  Changing this one file (+ secrets in .env.local) switches the whole app to a different company/personal brand.
 *  No brand-dependent values are hardcoded in the code body (lib/, app/) — everything is imported from here.
 *
 *  ⚠️  Never put secrets here.
 *      API keys, tokens, secrets, and passwords go only in `.env.local`. This file may be
 *      included in the client bundle, so it holds only "brand info that's safe to be public".
 *
 *  ── For first-time users ──
 *  1) Replace the top "brand baseline values" and "design tokens" with your own → propagates across the whole app and emails
 *  2) Choose the login method with `auth.mode` (password = simple / google = Workspace)
 *  3) Fill in keys in `.env.local` (copy .env.local.example)
 *  Detailed steps and where to get credentials are in docs/SETUP.md; the white-label structure is in docs/WHITELABEL.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Brand baseline values (change in one place; propagates to copy and senders) ──
const COMPANY = "Acme";                                    // company/service display name
const LEGAL_NAME = "Acme Inc.";                            // legal sender name (compliance footer)
// Domains are fixed as pure constants (client renders → env dependence causes hydration mismatch).
const LOGIN_DOMAIN = "example.com";                        // Workspace domain allowed for Google login (for google mode)
const SENDER_DOMAIN = "send.example.com";                  // allowed sending (From) domain (★core of send blocking)
const WEBSITE_URL = "https://www.example.com";             // company homepage (email footer logo link)

// Hosting base for images (logos/icons) — a publicly readable CDN/bucket URL.
const ASSET_BASE = "https://cdn.example.com/assets";

// ── Design tokens (by meaning) ─────────────────────────────────────────────────
//  Changing just these colors switches the "email body + app console UI" design all at once.
//  (Emails get colors injected here via lib/blocks.ts, the app UI via app/layout.tsx.)
const PRIMARY        = "#5b5bf0";   // brand accent — links, kicker, numbers, stats, app accent
const PRIMARY_CTA    = "#7c7cff";   // CTA button background (lighter end of the gradient)
const PRIMARY_DEEP   = "#4a4ad6";   // deep accent — app left rail, hover
const TEXT_HEADING   = "#0f0f1a";   // headings
const TEXT_BODY      = "#4a4a55";   // body
const TEXT_SUB       = "#6a6a75";   // secondary text
const TEXT_MUTED     = "#8a8a95";   // footer/comments
const HAIRLINE       = "#eceef5";   // thin divider
const CARD_BORDER    = "#e0e2ec";   // card (grid) border
const TINT_BG        = "#eef0ff";   // badge/accent background
const TINT_BORDER    = "#dce0ff";   // badge border
const EMAIL_PAGE_BG  = "#f5f5f5";   // email outer page background
const EMAIL_SURFACE  = "#ffffff";   // email card background
const EMAIL_SURFACE_BORDER = "#e5e5e5"; // email card border

export type BrandFromOption = { value: string; label: string; builtin?: boolean };
export type BrandLogo = { id: string; label: string; url: string; width: number };

export const brand = {
  // ── Identity ────────────────────────────────────────────────────────────
  identity: {
    companyName: COMPANY,
    legalName: LEGAL_NAME,
    appName: "Email Blast",
    appTitle: `${COMPANY} Email Blast`,
    appDescription: "Email blast tool",
    websiteUrl: WEBSITE_URL,
    /** App public base URL (used in the send loop, e.g. unsubscribe links). env(APP_BASE_URL) override. */
    appBaseUrl: (process.env.APP_BASE_URL || "https://email-blast.example.com").replace(/\/+$/, ""),
  },

  // ── Auth/domain ───────────────────────────────────────────────────────────
  auth: {
    /** Login method switch — this one line toggles between the two versions.
     *   "password" : single-password gate without Google (password value is ACCESS_PASSWORD in .env.local).
     *   "google"   : Google Workspace login (@loginDomain restricted). Requires GOOGLE_CLIENT_*. */
    mode: "password" as "password" | "google",
    /** The single operator identity in password mode = automatic admin. (used for session, sender ownership, audit) */
    operatorEmail: "you@example.com",
    /** Operator display name in password mode (used to auto-generate the sender display name). If empty, inferred from the email. */
    operatorName: COMPANY,
    /** Domain allowed for Google Workspace login (for google mode). */
    loginDomain: LOGIN_DOMAIN,
    /** Email domain allowed for the sender (From). */
    senderDomain: SENDER_DOMAIN,
  },

  // ── Senders / compliance ──────────────────────────────────────────────
  senders: {
    /** Built-in sender (always present, cannot be deleted). Operator additions live in data/from.json.
     *  ⚠️ At least 1 required (FROM_DEFAULT references [0]). Keep it matching senderDomain. */
    builtinFrom: [
      { value: `${COMPANY} <hello@${SENDER_DOMAIN}>`, label: COMPANY, builtin: true },
    ] as BrandFromOption[],
    /** Default Reply-To. This value is allowed even outside senderDomain (e.g. gmail) (resolveReplyTo). */
    replyToDefault: "inquiry@example.com",
    /** Sender name (Network Act Article 50(4)). env(SENDER_ORG_NAME) override. */
    orgName: process.env.SENDER_ORG_NAME || LEGAL_NAME,
    /** Sender physical postal address (CAN-SPAM). Omitted from the footer if empty. env(SENDER_POSTAL_ADDRESS) override.
     *  ⚠️ Must be filled before external sends (legal requirement). */
    postalAddress: process.env.SENDER_POSTAL_ADDRESS || "",
    /** Compliance contact email (unsubscribe mailto). env(SENDER_CONTACT_EMAIL) override. */
    contactEmail: process.env.SENDER_CONTACT_EMAIL || "inquiry@example.com",
  },

  // ── Email body render (lib/blocks.ts) ───────────────────────────────────
  email: {
    /** Email colors. ⚠️ Don't change the key names (teal/mint/tealTint…) — lib/blocks.ts and UI tokens
     *  reference them; the values are derived from the "design tokens" above (managed in one place). */
    colors: {
      teal: PRIMARY,            // accent/highlight (kicker, numbers, stat, links)
      mint: PRIMARY_CTA,        // CTA button background
      ink: TEXT_HEADING,        // headings
      body: TEXT_BODY,          // body
      sub: TEXT_SUB,            // secondary text
      muted: TEXT_MUTED,        // footer/comments
      hair: HAIRLINE,           // divider
      cardBorder: CARD_BORDER,  // card border
      tealTintBg: TINT_BG,      // badge background
      tealTintBorder: TINT_BORDER, // badge border
    },
    /** Email skeleton colors (page background, cards). Derived from the design tokens above. */
    surfaces: {
      pageBg: EMAIL_PAGE_BG,
      card: EMAIL_SURFACE,
      cardBorder: EMAIL_SURFACE_BORDER,
    },
    mono: "Menlo,'SF Mono',Consolas,'Liberation Mono',monospace",
    /** Header (top) default logo — used when spec.logo is unset. Replace with your own logo's public URL. */
    headerLogo: { url: `${ASSET_BASE}/header-logo.png`, alt: COMPANY, width: 130 },
    /** Footer (bottom) logo + click link. */
    footerLogo: { url: `${ASSET_BASE}/footer-logo.png`, alt: COMPANY, link: WEBSITE_URL, width: 100, height: 16 },
    /** Footer social icon images. */
    socialIcons: {
      x: `${ASSET_BASE}/x-logo.png`,
      linkedin: `${ASSET_BASE}/linkedin-logo.png`,
      youtube: `${ASSET_BASE}/youtube-logo.png`,
    },
    /** Footer social links (an empty string auto-hides that icon). Fill in if you have your own social accounts. */
    social: {
      x: "",
      linkedin: "",
      youtube: "",
    },
    /** Default footer inquiry email (when footer.inquiryEmail is unset). */
    defaultInquiry: "inquiry@example.com",
  },

  // ── Asset (image) storage ───────────────────────────────────────────────
  // Changing just the provider swaps the storage (adapters: lib/storage/adapters/*).
  // ⚠️ Only provider name and public URLs here. Credentials (keys) go in .env.local.
  assets: {
    /** Image storage backend (matches ADAPTERS in lib/storage/index.ts).
     *  "local" = zero external accounts (stores on server disk + app serves via /api/assets).
     *  "azure" etc. = object storage (bulk, CDN). Keys in .env.local. */
    provider: "local",
    /** Image delivery method (both supported, toggled by this one line):
     *   "attach" = on send, inline-attach local images to the mail via CID → no external hosting/public URL needed.
     *              Best for personal/small sends (but resends images per recipient → inefficient at scale). 40MB per mail limit.
     *   "hosted" = reference image URLs as-is (the mail client loads them externally). Efficient at scale but
     *              the app (or storage) must be live on a public domain. */
    delivery: "attach" as "attach" | "hosted",
    /** Hosting base for built-in logos/icons (external CDN — this URL stays hosted even in attach mode). */
    base: ASSET_BASE,
  },

  // ── Header logo registry (built-in list in lib/logos.ts) ──────────────────────
  logos: [
    { id: "primary", label: COMPANY, url: `${ASSET_BASE}/header-logo.png`, width: 130 },
  ] as BrandLogo[],

  // ── Template defaults ───────────────────────────────────────────────────────
  templates: {
    defaultSubject: `[알림] ${COMPANY}`,
  },

  // ── App UI ──────────────────────────────────────────────────────────────
  ui: {
    /** Top header wordmark. */
    headerBrand: COMPANY,
    /** Wordmark at the bottom of the public unsubscribe/resubscribe page. */
    footerWordmark: COMPANY,
    /** App console (web UI) accent color — app/layout.tsx injects it as a :root CSS variable (unified with email colors).
     *  Derived from the "design tokens" above, so the color only needs to be changed in one place. */
    appAccent: PRIMARY,         // → --brand / --ring
    appAccentDeep: PRIMARY_DEEP, // → --brand-deep / --rail
    appAccentBright: PRIMARY_CTA,// → --brand-mint (lighter end of the CTA gradient)
    login: {
      title: `${COMPANY} Email Blast`,
      subtitle: `${COMPANY} 계정으로 로그인하세요.`,
      /** Login screen copy for password mode. */
      passwordSubtitle: `접근하려면 비밀번호를 입력하세요.`,
      domainNotice: `@${LOGIN_DOMAIN} 계정만 접근할 수 있습니다.`,
      domainError: `@${LOGIN_DOMAIN} 계정만 로그인할 수 있습니다.`,
      passwordError: `비밀번호가 올바르지 않습니다.`,
    },
  },
};

export type Brand = typeof brand;
