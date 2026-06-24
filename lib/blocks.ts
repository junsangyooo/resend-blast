/**
 * Block composer — flat block spec (JSON) → design-system-fixed email HTML renderer.
 *
 * Model: the email body is a flat list of Block[] (no nested containers).
 *  - Each block's style defaults to a "position-based automatic value", overridable via tokens (align/size/weight/font/color/gap).
 *  - All tokens are a limited set of choices (no free px / arbitrary hex) → always on-brand even for non-developers.
 *  - Per-block optional parts (subnote/comment/title etc.) render only when the field is present.
 *  - grid block: cols(2|3) × cardType(feature|image|stat|cta) card group.
 *
 * Body text's {{name}}/{{email}} is substituted per recipient at send time (fillPlaceholders).
 * The footer's %%UNSUB_URL%% is replaced with a per-recipient signed unsubscribe URL at send time.
 * Inline formatting (html) in body text passes through sanitizeInline, allowing only whitelisted tags (bold/brand color).
 * Outlook compatibility: no rgba() (hex composited over white background).
 */
import { SENDER_ORG_NAME, SENDER_POSTAL_ADDRESS } from "./config";
import { brand } from "../brand.config";
import { UNSUB_PLACEHOLDER, fillPlaceholders } from "./personalize";

// Personalization substitution is split out into lib/personalize.ts (shared with client) — re-exported for existing import compatibility.
export { UNSUB_PLACEHOLDER, fillPlaceholders, fillSubject, usesPersonalization, hasBlankNameRisk } from "./personalize";
export type { PersonalizeVars } from "./personalize";

// ── Design tokens (injected from brand.config.ts's email.colors — design system fixed) ──
const C = brand.email.colors;
const TEAL = C.teal;
const MINT = C.mint;
const INK = C.ink;
const BODY = C.body;
const SUB = C.sub;
const MUTED = C.muted;
const HAIR = C.hair;
const CARD_BORDER = C.cardBorder;
const TEAL_TINT_BG = C.tealTintBg;
const TEAL_TINT_BORDER = C.tealTintBorder;
const MONO = brand.email.mono;
// Email skeleton colors (page background, card) — injected from brand.config.email.surfaces.
const PAGE_BG = brand.email.surfaces.pageBg;
const SURFACE = brand.email.surfaces.card;
const SURFACE_BORDER = brand.email.surfaces.cardBorder;

const LOGO_URL = brand.email.headerLogo.url;
const RLWRLD_LOGO = brand.email.footerLogo.url;
const X_ICON = brand.email.socialIcons.x;
const LI_ICON = brand.email.socialIcons.linkedin;
const YT_ICON = brand.email.socialIcons.youtube;

const DEFAULT_INQUIRY = brand.email.defaultInquiry;

// ── Block model (flat list) ──
export type Align = "left" | "center" | "right";
export type SizeToken = "S" | "M" | "L";
export type GapToken = "tight" | "sm" | "lg" | "";
export type ColorToken = "ink" | "body" | "teal" | "muted" | "";
export type CardType = "feature" | "image" | "stat" | "cta";

export type BlockType =
  | "heading" | "text" | "button" | "badge" | "kicker"
  | "numbered" | "agenda" | "grid" | "image" | "divider";

export type GridCard = {
  title?: string;
  desc?: string;
  img?: string;   // Azure Blob URL
  value?: string; // stat
  btn?: string;   // cta label
  url?: string;   // cta link
};

export type Block = {
  id: string;
  type: BlockType;
  // Common style tokens (empty/unset = automatic)
  align?: Align;
  gap?: GapToken;
  size?: SizeToken;
  weight?: "bold" | "normal" | "";
  font?: "sans" | "mono" | "";
  color?: ColorToken;
  // text
  text?: string;
  html?: string; // inline formatting (bold/brand color)
  // heading
  subnote?: string;
  level?: "title" | "subtitle"; // legacy compatibility
  // button
  label?: string;
  url?: string;
  topNote?: string;
  bottomNote?: string;
  arrow?: boolean; // whether to show → after the label (unset = true: existing saved-version compat. New blocks set false in emptyBlock)
  btnColor?: "mint" | "teal" | "ink" | ""; // button background token (unset = mint)
  // badge
  line1?: string;
  line2?: string;
  line2Href?: string; // link (http/https/mailto) on line2 (address etc.). Plain text if absent.
  // numbered / agenda
  title?: string;
  titleNote?: string;
  items?: { title: string; desc?: string }[];
  rows?: { time: string; label: string }[];
  // image
  alt?: string;
  caption?: string;
  width?: number;
  href?: string; // link (http/https/mailto) to navigate to on image click. Not clickable if absent.
  fullBleed?: boolean; // remove the 40px side padding → fill full card width (for banners).
  // grid
  cols?: number;
  cardType?: CardType;
  cardAlign?: Align;
  cards?: GridCard[];
};

export type TemplateSpec = {
  subject: string;
  preheader?: string;
  /** Body width. Default 600px (email standard) / wide 680px (safe max for Gmail/Outlook). */
  width?: "default" | "wide";
  showLogo: boolean;
  showFooter: boolean;
  tagline?: string;
  logo?: { url: string; width?: number; alt?: string };
  footer?: {
    inquiryEmail?: string;
    /** Whether to show the inquiry email line (default true). If false, omit "문의: …" from the footer. */
    showInquiry?: boolean;
    showSocial?: boolean;
    showUnsubscribe?: boolean;
    orgName?: string;
    address?: string;
  };
  blocks: Block[];
};

// ── id generation (shared browser/Node) ──
let _idSeq = 0;
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && (crypto as any).randomUUID) return (crypto as any).randomUUID();
  } catch {}
  _idSeq += 1;
  return `b${_idSeq}-${Date.now().toString(36)}`;
}

// ── helpers ──
function esc(s: string | undefined | null): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function nl2br(s: string): string {
  return esc(s).replace(/\n/g, "<br>");
}
function url(s: string): string {
  const t = String(s ?? "").trim();
  return /^(https?:|mailto:)/i.test(t) ? esc(t) : "#";
}
function clampWidth(w: number | undefined, fallback: number): number {
  if (!w || !Number.isFinite(w) || w <= 0) return fallback;
  return Math.min(1200, Math.max(1, Math.round(w)));
}

// ── Inline formatting sanitize: pass only allowed tags (block executable code / arbitrary styles) ──
const BRAND_HEX = new Set([INK, BODY, TEAL, MUTED].map((h) => h.toLowerCase()));
function pickBrandColor(tag: string): string {
  const m = tag.match(/color\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,6})/);
  if (!m) return "";
  const hex = m[1].toLowerCase();
  return BRAND_HEX.has(hex) ? hex : "";
}
/** Normalize text.html inline formatting to a whitelist (bold/italic/line break/brand-color span). */
export function sanitizeInline(html: string): string {
  let out = "";
  let last = 0;
  const tagRe = /<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    // escape text before the tag
    out += esc(html.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];
    const lower = tag.toLowerCase().replace(/\s+/g, "");
    if (/^<(b|strong)>$/.test(lower) || /^<(b|strong)\b/.test(tag.toLowerCase())) out += "<strong>";
    else if (lower === "</b>" || lower === "</strong>") out += "</strong>";
    else if (/^<(i|em)>$/.test(lower) || /^<(i|em)\b/.test(tag.toLowerCase())) out += "<em>";
    else if (lower === "</i>" || lower === "</em>") out += "</em>";
    else if (/^<br\/?>$/.test(lower)) out += "<br>";
    else if (/^<a\b/.test(tag.toLowerCase())) {
      const hm = tag.match(/href\s*=\s*["']?([^"'\s>]+)/i);
      const href = hm ? url(hm[1]) : "#";
      out += `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:${TEAL}; text-decoration:underline;">`;
    } else if (lower === "</a>") out += "</a>";
    else if (/^<(span|font)\b/.test(tag.toLowerCase())) {
      const c = pickBrandColor(tag);
      out += c ? `<span style="color:${c}">` : "<span>";
    } else if (lower === "</span>" || lower === "</font>") out += "</span>";
    // other tags (div, p, script, …) are removed
  }
  out += esc(html.slice(last));
  return out;
}

// ── Position-based automatic style + token override ──
const COLOR_MAP: Record<string, string> = { ink: INK, body: BODY, teal: TEAL, muted: MUTED };
const HEADING_PX: Record<SizeToken, number> = { S: 16, M: 20, L: 34 };
const TEXT_PX: Record<SizeToken, number> = { S: 13, M: 14.5, L: 15.5 };

// ── Button color tokens (shared with the UI canvas — prevent canvas-renderer mismatch) ──
export const BUTTON_COLORS: Record<string, { bg: string; fg: string }> = {
  mint: { bg: MINT, fg: INK },
  teal: { bg: TEAL, fg: "#ffffff" },
  ink: { bg: INK, fg: "#ffffff" },
};
export function resolveButtonColors(b: Pick<Block, "btnColor">): { bg: string; fg: string } {
  return BUTTON_COLORS[b.btnColor ?? ""] ?? BUTTON_COLORS.mint;
}

export type Resolved = { align: Align; size: SizeToken; weight: string; color: string; font: string };
export function resolveStyle(b: Block, idx: number): Resolved {
  const top = b.type === "heading" && idx <= 1;
  let align: Align =
    b.type === "kicker" ? "center"
    : b.type === "button" || b.type === "badge" ? "center"
    : top ? "center" : "left";
  let size: SizeToken = b.type === "heading" ? (top ? "L" : "M") : "M";
  let weight = "normal";
  let color = b.type === "kicker" ? TEAL : b.type === "heading" ? INK : BODY;
  let font = top ? MONO : "inherit";
  // legacy: heading.level
  if (b.type === "heading") {
    if (b.level === "title") size = "L";
    else if (b.level === "subtitle") size = "M";
  }
  if (b.align) align = b.align;
  if (b.size) size = b.size;
  if (b.weight === "bold") weight = "bold"; else if (b.weight === "normal") weight = "normal";
  if (b.color && COLOR_MAP[b.color]) color = COLOR_MAP[b.color];
  if (b.font === "mono") font = MONO; else if (b.font === "sans") font = "inherit";
  return { align, size, weight, color, font };
}

// ── Comment (subnote) small gray line ──
function noteHtml(text: string | undefined, align: Align, margin: string): string {
  if (text === undefined) return "";
  return `<p style="text-align:${align}; color:${MUTED}; font-size:12.5px; line-height:1.6; margin:${margin};">${nl2br(text)}</p>`;
}

// ── Leaf renderers ──
function renderKicker(b: Block, s: Resolved): string {
  if (!b.text?.trim()) return "";
  return `<p style="text-align:${s.align}; color:${s.color}; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0;">${esc(b.text)}</p>`;
}
function renderHeading(b: Block, s: Resolved): string {
  if (!b.text?.trim()) return "";
  const px = HEADING_PX[s.size];
  const fw = s.weight === "bold" ? 800 : 700;
  const main = `<h1 style="text-align:${s.align}; color:${s.color}; font-size:${px}px; font-weight:${fw}; line-height:1.2; letter-spacing:-0.3px; margin:0; font-family:${s.font};">${nl2br(b.text)}</h1>`;
  return main + noteHtml(b.subnote, s.align, "8px 0 0");
}
function renderText(b: Block, s: Resolved): string {
  const px = TEXT_PX[s.size];
  const fw = s.weight === "bold" ? 700 : 400;
  const inner = b.html !== undefined ? sanitizeInline(b.html) : nl2br(b.text ?? "");
  if (!inner.trim()) return "";
  return `<p style="text-align:${s.align}; color:${s.color}; font-size:${px}px; line-height:1.8; font-weight:${fw}; margin:0; font-family:${s.font};">${inner}</p>`;
}
function renderBadge(b: Block, s: Resolved): string {
  if (!b.line1?.trim() && !b.line2?.trim()) return "";
  const center = s.align === "center";
  // In-box CTA (optional): if label is present, render a mint button inside the box below line2.
  const bc = resolveButtonColors(b);
  const innerBtn = b.label?.trim()
    ? `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:14px auto 0;">
        <tr><td align="center" bgcolor="${bc.bg}" style="background-color:${bc.bg}; border-radius:8px;">
          <a target="_blank" rel="noopener noreferrer" href="${url(b.url ?? "")}" style="display:inline-block; padding:12px 34px; color:${bc.fg}; font-size:14px; font-weight:700; text-decoration:none; letter-spacing:0.3px;">${esc(b.label)}${b.arrow === false ? "" : " &rarr;"}</a>
        </td></tr>
      </table>`
    : "";
  const ta = innerBtn ? "text-align:center; " : "";
  const pad = innerBtn ? "18px 24px" : "14px 22px";
  const box = `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 ${center ? "auto" : "0"};">
    <tr><td bgcolor="${TEAL_TINT_BG}" style="background-color:${TEAL_TINT_BG}; border:1px solid ${TEAL_TINT_BORDER}; border-radius:6px; padding:${pad};">
      <p style="${ta}color:${INK}; font-size:15px; font-weight:600; margin:0${b.line2?.trim() ? " 0 4px 0" : ""}; letter-spacing:0.3px;">${esc(b.line1)}</p>
      ${b.line2?.trim() ? `<p style="${ta}color:${SUB}; font-size:13px; margin:0;">${b.line2Href?.trim() ? `<a href="${url(b.line2Href)}" target="_blank" rel="noopener noreferrer" style="color:${SUB}; text-decoration:underline;">${esc(b.line2)}</a>` : esc(b.line2)}</p>` : ""}
      ${innerBtn}
    </td></tr>
  </table>`;
  return box + noteHtml(b.bottomNote, s.align, "10px 0 0");
}
function renderButton(b: Block, s: Resolved): string {
  if (!b.label?.trim()) return "";
  const center = s.align === "center";
  const bc = resolveButtonColors(b);
  const btn = `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 ${center ? "auto" : "0"};">
    <tr><td align="center" bgcolor="${bc.bg}" style="background-color:${bc.bg}; border-radius:8px;">
      <a target="_blank" rel="noopener noreferrer" href="${url(b.url ?? "")}" style="display:inline-block; padding:14px 36px; color:${bc.fg}; font-size:14.5px; font-weight:700; text-decoration:none; letter-spacing:0.3px;">${esc(b.label)}${b.arrow === false ? "" : " &rarr;"}</a>
    </td></tr>
  </table>`;
  return noteHtml(b.topNote, s.align, "0 0 10px") + btn + noteHtml(b.bottomNote, s.align, "10px 0 0");
}
function renderNumbered(b: Block, s: Resolved): string {
  const items = (b.items ?? []).filter((it) => it?.title?.trim());
  const rows = items.map((it, i) => {
    const n = String(i + 1).padStart(2, "0");
    const last = i === items.length - 1;
    const desc = it.desc?.trim() ? `<br><span style="color:${SUB}; font-size:13px;">${nl2br(it.desc)}</span>` : "";
    return `<tr><td style="padding:0 0 ${last ? "0" : "12px"} 0; vertical-align:top;">
      <table cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td valign="top" width="28" style="color:${TEAL}; font-family:${MONO}; font-size:13px; font-weight:600; padding-top:1px;">${n}</td>
        <td><strong style="color:${INK};">${esc(it.title)}</strong>${desc}</td>
      </tr></table></td></tr>`;
  }).join("\n");
  if (!rows && b.title === undefined) return "";
  const head = b.title !== undefined
    ? `<p style="text-align:${s.align}; color:${INK}; font-size:18px; font-weight:700; margin:0 0 ${b.titleNote !== undefined ? "4px" : "14px"};">${esc(b.title)}</p>` + noteHtml(b.titleNote, s.align, "0 0 14px")
    : "";
  const table = rows ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-size:14px; color:${BODY}; line-height:1.75; margin:0;">${rows}</table>` : "";
  return head + table + noteHtml(b.bottomNote, s.align, "14px 0 0");
}
function renderAgenda(b: Block, s: Resolved): string {
  const rs = (b.rows ?? []).filter((r) => r?.time?.trim() || r?.label?.trim());
  const rows = rs.map((r) => `<tr>
      <td style="color:${SUB}; font-family:${MONO}; font-size:13px; padding:3px 18px 3px 0; white-space:nowrap; vertical-align:top;">${esc(r.time)}</td>
      <td style="padding:3px 0; vertical-align:top;">${esc(r.label)}</td>
    </tr>`).join("\n");
  if (!rows && b.title === undefined) return "";
  const head = b.title !== undefined
    ? `<p style="text-align:${s.align}; color:${INK}; font-size:18px; font-weight:700; margin:0 0 ${b.titleNote !== undefined ? "4px" : "14px"};">${esc(b.title)}</p>` + noteHtml(b.titleNote, s.align, "0 0 14px")
    : "";
  const table = rows ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-size:14px; color:${BODY}; line-height:1.9;">${rows}</table>` : "";
  return head + table + noteHtml(b.bottomNote, s.align, "14px 0 0");
}
function renderImage(b: Block, s: Resolved): string {
  if (!b.url?.trim()) return noteHtml(b.title, s.align, "0 0 10px");
  const w = b.width && b.width > 0 ? ` width="${clampWidth(b.width, 600)}"` : "";
  const head = b.title !== undefined
    ? `<p style="text-align:${s.align}; color:${INK}; font-size:16px; font-weight:700; margin:0 0 10px;">${esc(b.title)}</p>` : "";
  const imgTag = `<img src="${url(b.url)}"${w} alt="${esc(b.alt ?? "")}" style="display:block; margin:0 ${s.align === "center" ? "auto" : "0"}; border:0; max-width:100%; height:auto; border-radius:6px;">`;
  const img = b.href?.trim()
    ? `<a href="${url(b.href)}" target="_blank" rel="noopener noreferrer" style="display:block; text-decoration:none; margin:0 ${s.align === "center" ? "auto" : "0"}; max-width:100%;">${imgTag}</a>`
    : imgTag;
  return head + img + noteHtml(b.caption, s.align, "10px 0 0");
}
function dividerHtml(): string {
  return `<div style="border-top:1px solid ${HAIR}; height:1px; line-height:1px;">&nbsp;</div>`;
}

// ── grid block ──
function gridCardHtml(b: Block, c: GridCard, align: Align): string {
  const t = b.cardType ?? "feature";
  const pad = "16px";
  const border = `1px solid ${CARD_BORDER}`;
  if (t === "image") {
    const img = c.img?.trim()
      ? `<img src="${url(c.img)}" alt="${esc(c.title ?? "")}" style="display:block; width:100%; height:auto; border-radius:8px; margin:0 0 11px; border:0;">`
      : "";
    const desc = c.desc?.trim() ? `<p style="margin:0; color:${SUB}; font-size:12.5px; line-height:1.6;">${nl2br(c.desc)}</p>` : "";
    return `<div style="border:${border}; border-radius:12px; padding:${pad}; text-align:${align};">${img}${desc}</div>`;
  }
  if (t === "stat") {
    const v = c.value?.trim() ? `<p style="margin:0; color:${TEAL}; font-family:${MONO}; font-size:28px; font-weight:800; line-height:1.1; text-align:${align};">${esc(c.value)}</p>` : "";
    const l = c.title?.trim() ? `<p style="margin:6px 0 0; color:${SUB}; font-size:12.5px; text-align:${align};">${esc(c.title)}</p>` : "";
    return `<div style="border:${border}; border-radius:12px; padding:${pad};">${v}${l}</div>`;
  }
  if (t === "cta") {
    const title = c.title?.trim() ? `<p style="margin:0; color:${INK}; font-size:15px; font-weight:700; text-align:${align};">${esc(c.title)}</p>` : "";
    const desc = c.desc?.trim() ? `<p style="margin:6px 0 0; color:${SUB}; font-size:12.5px; line-height:1.6; text-align:${align};">${nl2br(c.desc)}</p>` : "";
    const moreLabel = c.btn?.trim() || "자세히";
    const more = `<p style="margin:13px 0 0; color:${TEAL}; font-size:13px; font-weight:700; text-align:${align};">${esc(moreLabel)} &rarr;</p>`;
    const inner = `<div style="border:${border}; border-radius:12px; padding:${pad};">${title}${desc}${more}</div>`;
    return c.url?.trim()
      ? `<a href="${url(c.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; display:block;">${inner}</a>`
      : inner;
  }
  // feature
  const title = c.title?.trim() ? `<p style="margin:0; color:${INK}; font-size:14.5px; font-weight:700; text-align:${align};">${esc(c.title)}</p>` : "";
  const desc = c.desc?.trim() ? `<p style="margin:6px 0 0; color:${SUB}; font-size:12.5px; line-height:1.6; text-align:${align};">${nl2br(c.desc)}</p>` : "";
  return `<div style="border:${border}; border-radius:12px; padding:${pad}; text-align:${align};">${title}${desc}</div>`;
}
function renderGrid(b: Block): string {
  const cards = b.cards ?? [];
  if (!cards.length) return "";
  const cols = b.cols === 3 ? 3 : 2;
  const align: Align = b.cardAlign ?? (b.cardType === "stat" ? "center" : b.cardType === "cta" ? "center" : "left");
  const wPct = cols === 3 ? "33.33%" : "50%";
  // Responsive: 1-column stack on small screens (supported clients). Keeps cell ratios when unsupported.
  const cells = cards.map((c) =>
    `<td class="eb-col" width="${wPct}" style="width:${wPct}; vertical-align:top; padding:7px;">${gridCardHtml(b, c, align)}</td>`
  );
  let rowsHtml = "";
  for (let i = 0; i < cells.length; i += cols) {
    const slice = cells.slice(i, i + cols);
    while (slice.length < cols) slice.push(`<td class="eb-col" width="${wPct}" style="width:${wPct}; padding:7px;"></td>`);
    rowsHtml += `<tr>${slice.join("")}</tr>`;
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 -7px; border-collapse:separate; border-spacing:0;">${rowsHtml}</table>`;
}

// ── Block → one row (<tr><td>) ── (export: so the UI canvas uses the same spacing)
export const GAP_PX: Record<string, number> = { tight: 2, sm: 7, "": 16, lg: 30 };
function renderLeafInner(b: Block, idx: number): string {
  if (b.type === "grid") return renderGrid(b);
  if (b.type === "divider") return dividerHtml();
  const s = resolveStyle(b, idx);
  switch (b.type) {
    case "kicker": return renderKicker(b, s);
    case "heading": return renderHeading(b, s);
    case "text": return renderText(b, s);
    case "badge": return renderBadge(b, s);
    case "button": return renderButton(b, s);
    case "numbered": return renderNumbered(b, s);
    case "agenda": return renderAgenda(b, s);
    case "image": return renderImage(b, s);
    default: return "";
  }
}
function renderBlockRow(b: Block, idx: number): string {
  const inner = renderLeafInner(b, idx);
  if (!inner.trim()) return "";
  const gapY = GAP_PX[b.gap ?? ""] ?? GAP_PX[""];
  const padX = b.type === "image" && b.fullBleed ? 0 : 40;
  return `<tr><td style="padding:${gapY}px ${padX}px;">${inner}</td></tr>`;
}

function renderLogo(spec: TemplateSpec): string {
  const src = spec.logo?.url?.trim() || LOGO_URL;
  const w = clampWidth(spec.logo?.width, brand.email.headerLogo.width);
  const alt = spec.logo?.alt?.trim() || brand.email.headerLogo.alt;
  const tag = spec.tagline?.trim()
    ? `<p style="color:${MUTED}; font-size:12px; margin:0; line-height:1.5;">${esc(spec.tagline.trim())}</p>`
    : "";
  return `<tr><td style="padding-bottom:32px; text-align:center;">
    <img src="${url(src)}" width="${w}" alt="${esc(alt)}" style="display:block; margin:0 auto ${tag ? "8px" : "0"} auto; border:0; height:auto;">
    ${tag}
  </td></tr>`;
}

function renderFooter(footer?: TemplateSpec["footer"]): string {
  const email = footer?.inquiryEmail?.trim() || DEFAULT_INQUIRY;
  const showInquiry = footer?.showInquiry !== false;
  const showSocial = footer?.showSocial !== false;
  const showUnsub = footer?.showUnsubscribe !== false;
  const orgName = footer?.orgName?.trim() || SENDER_ORG_NAME;
  const address = footer?.address?.trim() || SENDER_POSTAL_ADDRESS;
  const year = new Date().getFullYear();

  // Social links — auto-omit an icon if its URL in brand.email.social is empty.
  const socialItems = [
    { href: brand.email.social.x, icon: X_ICON, w: 14, h: 14, alt: "X" },
    { href: brand.email.social.linkedin, icon: LI_ICON, w: 14, h: 14, alt: "LinkedIn" },
    { href: brand.email.social.youtube, icon: YT_ICON, w: 24, h: 21, alt: "YouTube" },
  ].filter((s) => s.href?.trim());
  const social = showSocial && socialItems.length
    ? `<p style="margin:0 0 16px 0;">
      ${socialItems.map((s) => `<a target="_blank" rel="noopener noreferrer" href="${url(s.href)}" style="display:inline-block; text-decoration:none; margin:0 8px; vertical-align:middle;"><img src="${s.icon}" width="${s.w}" height="${s.h}" alt="${s.alt}" style="display:block; border:0;"></a>`).join("")}
    </p>`
    : "";

  const inquiryPart = showInquiry
    ? ` · 문의: <a href="mailto:${esc(email)}" style="color:${MUTED}; text-decoration:underline;">${esc(email)}</a>`
    : "";
  const senderLine = `<p style="color:${MUTED}; font-size:11px; line-height:1.6; margin:0 0 4px 0;">
      ${esc(orgName)}${inquiryPart}${address ? ` · ${esc(address)}` : ""}
    </p>`;

  const unsubLine = showUnsub ? `<p style="color:${MUTED}; font-size:11px; line-height:1.6; margin:0 0 12px 0;">
      이 메일을 더 이상 받고 싶지 않으시면 <a href="${UNSUB_PLACEHOLDER}" style="color:${MUTED}; text-decoration:underline;">수신거부</a> 하실 수 있습니다.
    </p>` : "";

  return `<tr><td style="padding:48px 0 0 0; text-align:center;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 20px 0;"><tr><td style="border-top:1px solid ${HAIR};"></td></tr></table>
    ${social}
    <p style="margin:0 0 8px 0;">
      <a target="_blank" rel="noopener noreferrer" href="${url(brand.email.footerLogo.link)}" style="display:inline-block; text-decoration:none;"><img src="${RLWRLD_LOGO}" width="${brand.email.footerLogo.width}" height="${brand.email.footerLogo.height}" alt="${esc(brand.email.footerLogo.alt)}" style="display:block; border:0; margin:0 auto;"></a>
    </p>
    ${senderLine}
    ${unsubLine}
    <p style="color:#aaaaaa; font-size:10px; line-height:1.5; margin:0;">&copy; ${year} ${esc(orgName)}</p>
  </td></tr>`;
}

/** spec.width token → px. 600 = email standard, 680 = safe max for Gmail web / Outlook reading pane. */
export function specWidthPx(spec: Pick<TemplateSpec, "width">): number {
  return spec.width === "wide" ? 680 : 600;
}

/** spec → body HTML to place inside <body>. */
export function renderTemplate(spec: TemplateSpec): string {
  const blocks = (spec.blocks ?? []).filter((b) => b && b.type);
  const rows = blocks.map((b, i) => renderBlockRow(b, i)).filter((h) => h.trim()).join("\n");
  const W = specWidthPx(spec);

  const preheader = spec.preheader?.trim()
    ? `<div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:${PAGE_BG};">${esc(spec.preheader)}</div>`
    : "";

  const card = rows
    ? `<tr><td style="background-color:${SURFACE}; border:1px solid ${SURFACE_BORDER}; border-radius:8px; overflow:hidden;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 0;">${rows}</table>
      </td></tr>`
    : "";

  // Media query for the responsive grid (supported clients only). Falls back to inline styles when unsupported.
  const responsive = `<style>@media screen and (max-width:480px){.eb-col{display:block!important;width:100%!important}}</style>`;

  return `${responsive}<div style="margin:0; padding:0; background-color:${PAGE_BG};">
  ${preheader}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${PAGE_BG}; padding:0;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="${W}" cellpadding="0" cellspacing="0" role="presentation" style="max-width:${W}px; width:100%;">
        ${spec.showLogo ? renderLogo(spec) : ""}
        ${card}
        ${spec.showFooter ? renderFooter(spec.footer) : ""}
      </table>
    </td></tr>
  </table>
</div>`;
}

// ── Sample substitution for preview (actual substitution logic is in lib/personalize.ts) ──
export function previewFill(html: string): string {
  return fillPlaceholders(html, { name: "홍길동", email: `sample@${brand.auth.senderDomain}`, unsubscribeUrl: "#" });
}

// ── Legacy (container tree) spec → flat model migration ──
const NEW_LEAF = new Set<string>(["heading", "text", "button", "badge", "kicker", "numbered", "agenda", "grid", "image", "divider"]);
export function migrateSpec(spec: any): TemplateSpec {
  if (!spec || typeof spec !== "object") return spec;
  const out: Block[] = [];
  for (const b of Array.isArray(spec.blocks) ? spec.blocks : []) flattenBlock(b, out);
  return { ...spec, blocks: out };
}
function flattenBlock(b: any, out: Block[]): void {
  if (!b || typeof b !== "object") return;
  // already the flat new model
  if (b.id && NEW_LEAF.has(b.type)) { out.push(b as Block); return; }
  // container tree (old version): flatten children
  if (b.type === "container" && Array.isArray(b.children)) {
    for (const c of b.children) flattenBlock(c, out);
    return;
  }
  // very old flat format (hero/section/cta/numbered/agenda/image/divider)
  const id = b.id || newId();
  switch (b.type) {
    case "hero": {
      if (b.kicker?.trim?.()) out.push({ id: newId(), type: "kicker", text: b.kicker });
      if (b.title?.trim?.()) out.push({ id: newId(), type: "heading", size: "L", text: b.title });
      if (b.dateBadge && (b.dateBadge.line1 || b.dateBadge.line2)) out.push({ id: newId(), type: "badge", line1: b.dateBadge.line1, line2: b.dateBadge.line2 });
      if (b.body?.trim?.()) out.push({ id: newId(), type: "text", text: b.body });
      if (b.cta?.label?.trim?.()) out.push({ id: newId(), type: "button", label: b.cta.label, url: b.cta.url });
      return;
    }
    case "section": {
      if (b.kicker?.trim?.()) out.push({ id: newId(), type: "kicker", text: b.kicker });
      if (b.heading?.trim?.()) out.push({ id: newId(), type: "heading", text: b.heading });
      for (const p of (b.paragraphs ?? [])) if (p?.trim?.()) out.push({ id: newId(), type: "text", text: p });
      return;
    }
    case "cta": {
      if (b.heading?.trim?.()) out.push({ id: newId(), type: "heading", text: b.heading });
      if (b.subtext?.trim?.()) out.push({ id: newId(), type: "text", text: b.subtext });
      if (b.label?.trim?.()) out.push({ id: newId(), type: "button", label: b.label, url: b.url });
      if (b.footnote?.trim?.()) out.push({ id: newId(), type: "text", text: b.footnote });
      return;
    }
    case "numbered": {
      if (b.kicker?.trim?.()) out.push({ id: newId(), type: "kicker", text: b.kicker });
      out.push({ id, type: "numbered", title: b.heading, items: b.items ?? [] });
      return;
    }
    case "agenda": {
      if (b.kicker?.trim?.()) out.push({ id: newId(), type: "kicker", text: b.kicker });
      out.push({ id, type: "agenda", rows: b.rows ?? [] });
      return;
    }
    case "image":
      out.push({ id, type: "image", url: b.url, alt: b.alt, caption: b.caption, width: b.width });
      return;
    case "divider":
      out.push({ id, type: "divider" });
      return;
    default:
      return;
  }
}

// ── Palette (for UI) ──
export const BLOCK_PALETTE: { type: BlockType; label: string; hint: string }[] = [
  { type: "heading", label: "제목", hint: "대제목/소제목" },
  { type: "text", label: "본문", hint: "문단 텍스트 (드래그로 부분 강조)" },
  { type: "button", label: "버튼", hint: "민트 CTA 버튼" },
  { type: "badge", label: "날짜 배지", hint: "1·2줄 강조 박스" },
  { type: "kicker", label: "작은 라벨", hint: "작은 대문자 라벨" },
  { type: "numbered", label: "번호 목록", hint: "01·02… 포인트" },
  { type: "agenda", label: "어젠다 표", hint: "시간 ─ 내용" },
  { type: "grid", label: "그리드", hint: "카드 묶음 (2·3열)" },
  { type: "image", label: "이미지", hint: "업로드 → 가운데" },
  { type: "divider", label: "구분선", hint: "얇은 가로선" },
];

export function emptyBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "heading": return { id, type, text: "" };
    case "text": return { id, type, html: "" };
    // New buttons/badges default arrow off (unset=true kept only for existing saved-version compat).
    case "button": return { id, type, label: "", url: "", arrow: false };
    case "badge": return { id, type, line1: "", line2: "", arrow: false };
    case "kicker": return { id, type, text: "" };
    case "numbered": return { id, type, items: [{ title: "", desc: "" }] };
    case "agenda": return { id, type, rows: [{ time: "", label: "" }] };
    case "grid": return { id, type, cols: 2, cardType: "feature", cards: [{ title: "", desc: "" }, { title: "", desc: "" }] };
    case "image": return { id, type };
    case "divider": return { id, type };
  }
}
