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
const FOOTER_LOGO = brand.email.footerLogo.url;
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
  descHtml?: string;
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
  items?: { title: string; desc?: string; descHtml?: string }[];
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
    /** 회사명(전송자 명칭) 표시 여부 (기본 true). 문의·주소까지 모두 끄면 해당 줄 자체가 사라짐. */
    showOrgName?: boolean;
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
/** sanitizeInline 전용 escaper — 이미 escape 된 entity 는 보존해 재적용(idempotent)을 보장.
 *  전역 esc() 는 그대로 둔다: subject/제목 등 평문 필드는 리터럴 escape 시맨틱 유지. */
function escKeepEntities(s: string): string {
  return s
    .replace(/&(?!(?:amp|lt|gt|quot|#39|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
/** text.html 의 인라인 서식을 화이트리스트(굵게/기울임/줄바꿈/브랜드색 span)로 정규화. idempotent. */
export function sanitizeInline(html: string): string {
  let out = "";
  let last = 0;
  const tagRe = /<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    // 태그 이전 텍스트는 escape (entity 보존 — 재적용해도 이중 escape 안 됨)
    out += escKeepEntities(html.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];
    const lower = tag.toLowerCase().replace(/\s+/g, "");
    if (/^<(b|strong)>$/.test(lower) || /^<(b|strong)\b/.test(tag.toLowerCase())) out += "<strong>";
    else if (lower === "</b>" || lower === "</strong>") out += "</strong>";
    else if (/^<(i|em)>$/.test(lower) || /^<(i|em)\b/.test(tag.toLowerCase())) out += "<em>";
    else if (lower === "</i>" || lower === "</em>") out += "</em>";
    else if (/^<(u)>$/.test(lower) || /^<u\b/.test(tag.toLowerCase())) out += "<u>";
    else if (lower === "</u>") out += "</u>";
    else if (/^<(s|strike|del)>$/.test(lower) || /^<(s|strike|del)\b/.test(tag.toLowerCase())) out += "<s>";
    else if (lower === "</s>" || lower === "</strike>" || lower === "</del>") out += "</s>";
    else if (/^<br\/?>$/.test(lower)) out += "<br>";
    else if (/^<a\b/.test(tag.toLowerCase())) {
      const hm = tag.match(/href\s*=\s*["']?([^"'\s>]+)/i);
      // href 는 attribute 컨텍스트라 이전 pass 에서 &amp; 로 escape 되어 있을 수 있음 — 되돌린 뒤 재escape (idempotent)
      const href = hm ? url(hm[1].replace(/&amp;/g, "&")) : "#";
      out += `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:${TEAL}; text-decoration:underline;">`;
    } else if (lower === "</a>") out += "</a>";
    else if (/^<(span|font)\b/.test(tag.toLowerCase())) {
      const c = pickBrandColor(tag);
      out += c ? `<span style="color:${c}">` : "<span>";
    } else if (lower === "</span>" || lower === "</font>") out += "</span>";
    // other tags (div, p, script, …) are removed
  }
  out += escKeepEntities(html.slice(last));
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

// ── 에디터 주석(미리보기 전용) ──
// renderTemplate(spec, { annotate: true }) 일 때만 data-eb-* 속성을 붙여, 스튜디오 미리보기에서
// "이 글자 = 어느 블록의 어느 필드"를 알 수 있게 한다. 저장·발송 HTML 에는 절대 붙지 않는다.
let ANNOTATE = false;
/** Editable field: data-eb-f="<blockId>:<path>", kind rich (inline HTML) or plain (text). */
function fa(b: { id: string }, path: string, rich = false): string {
  return ANNOTATE ? ` data-eb-f="${b.id}:${path}" data-eb-k="${rich ? "rich" : "plain"}"` : "";
}
/** Wrap inline text in an editable span — only in the editor preview, never in saved/sent HTML. */
function fw(b: { id: string }, path: string, inner: string): string {
  // data-eb-w marks an editor-only wrapper: unwrapped in the code view and skipped in element indexing.
  return ANNOTATE ? `<span data-eb-w="1"${fa(b, path)}>${inner}</span>` : inner;
}
/** Link target field (href). */
function la(b: { id: string }, path: string): string {
  return ANNOTATE ? ` data-eb-l="${b.id}:${path}"` : "";
}
/** Image source field (src). */
function ia(b: { id: string }, path: string): string {
  return ANNOTATE ? ` data-eb-i="${b.id}:${path}"` : "";
}

// ── 코멘트(부제) 작은 회색 줄 ──
function noteHtml(text: string | undefined, align: Align, margin: string, attr = ""): string {
  if (text === undefined) return "";
  return `<p${attr} style="text-align:${align}; color:${MUTED}; font-size:12.5px; line-height:1.6; margin:${margin};">${nl2br(text)}</p>`;
}

// ── Leaf renderers ──
function renderKicker(b: Block, s: Resolved): string {
  if (!b.text?.trim()) return "";
  return `<p${fa(b, "text")} style="text-align:${s.align}; color:${s.color}; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0;">${esc(b.text)}</p>`;
}
function renderHeading(b: Block, s: Resolved): string {
  if (!b.text?.trim()) return "";
  const px = HEADING_PX[s.size];
  const fw = s.weight === "bold" ? 800 : 700;
  const main = `<h1${fa(b, "text")} style="text-align:${s.align}; color:${s.color}; font-size:${px}px; font-weight:${fw}; line-height:1.2; letter-spacing:-0.3px; margin:0; font-family:${s.font};">${nl2br(b.text)}</h1>`;
  return main + noteHtml(b.subnote, s.align, "8px 0 0", fa(b, "subnote"));
}
function renderText(b: Block, s: Resolved): string {
  const px = TEXT_PX[s.size];
  const fw = s.weight === "bold" ? 700 : 400;
  const inner = b.html !== undefined ? sanitizeInline(b.html) : nl2br(b.text ?? "");
  if (!inner.trim()) return "";
  const f = b.html !== undefined ? fa(b, "html", true) : fa(b, "text");
  return `<p${f} style="text-align:${s.align}; color:${s.color}; font-size:${px}px; line-height:1.8; font-weight:${fw}; margin:0; font-family:${s.font};">${inner}</p>`;
}
function renderBadge(b: Block, s: Resolved): string {
  if (!b.line1?.trim() && !b.line2?.trim()) return "";
  const center = s.align === "center";
  // In-box CTA (optional): if label is present, render a mint button inside the box below line2.
  const bc = resolveButtonColors(b);
  const innerBtn = b.label?.trim()
    ? `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:14px auto 0;">
        <tr><td align="center" bgcolor="${bc.bg}" style="background-color:${bc.bg}; border-radius:8px;">
          <a${la(b, "url")} target="_blank" rel="noopener noreferrer" href="${url(b.url ?? "")}" style="display:inline-block; padding:12px 34px; color:${bc.fg}; font-size:14px; font-weight:700; text-decoration:none; letter-spacing:0.3px;">${fw(b, "label", esc(b.label))}${b.arrow === false ? "" : " &rarr;"}</a>
        </td></tr>
      </table>`
    : "";
  const ta = innerBtn ? "text-align:center; " : "";
  const pad = innerBtn ? "18px 24px" : "14px 22px";
  const box = `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 ${center ? "auto" : "0"};">
    <tr><td bgcolor="${TEAL_TINT_BG}" style="background-color:${TEAL_TINT_BG}; border:1px solid ${TEAL_TINT_BORDER}; border-radius:6px; padding:${pad};">
      <p${fa(b, "line1")} style="${ta}color:${INK}; font-size:15px; font-weight:600; margin:0${b.line2?.trim() ? " 0 4px 0" : ""}; letter-spacing:0.3px;">${esc(b.line1)}</p>
      ${b.line2?.trim() ? `<p style="${ta}color:${SUB}; font-size:13px; margin:0;">${b.line2Href?.trim() ? `<a${la(b, "line2Href")}${fa(b, "line2")} href="${url(b.line2Href)}" target="_blank" rel="noopener noreferrer" style="color:${SUB}; text-decoration:underline;">${esc(b.line2)}</a>` : fw(b, "line2", esc(b.line2))}</p>` : ""}
      ${innerBtn}
    </td></tr>
  </table>`;
  return box + noteHtml(b.bottomNote, s.align, "10px 0 0", fa(b, "bottomNote"));
}
function renderButton(b: Block, s: Resolved): string {
  if (!b.label?.trim()) return "";
  const center = s.align === "center";
  const bc = resolveButtonColors(b);
  const btn = `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 ${center ? "auto" : "0"};">
    <tr><td align="center" bgcolor="${bc.bg}" style="background-color:${bc.bg}; border-radius:8px;">
      <a${la(b, "url")} target="_blank" rel="noopener noreferrer" href="${url(b.url ?? "")}" style="display:inline-block; padding:14px 36px; color:${bc.fg}; font-size:14.5px; font-weight:700; text-decoration:none; letter-spacing:0.3px;">${fw(b, "label", esc(b.label))}${b.arrow === false ? "" : " &rarr;"}</a>
    </td></tr>
  </table>`;
  return noteHtml(b.topNote, s.align, "0 0 10px", fa(b, "topNote")) + btn + noteHtml(b.bottomNote, s.align, "10px 0 0", fa(b, "bottomNote"));
}
function renderNumbered(b: Block, s: Resolved): string {
  // Keep each item's original index — the editor maps preview text back to items.<index>.
  const items = (b.items ?? []).map((it, oi) => ({ it, oi })).filter(({ it }) => it?.title?.trim());
  const rows = items.map(({ it, oi }, i) => {
    const n = String(i + 1).padStart(2, "0");
    const last = i === items.length - 1;
    const descInner = it.descHtml !== undefined ? sanitizeInline(it.descHtml) : it.desc?.trim() ? nl2br(it.desc) : "";
    const df = it.descHtml !== undefined ? fa(b, `items.${oi}.descHtml`, true) : fa(b, `items.${oi}.desc`);
    const desc = descInner ? `<br><span${df} style="color:${SUB}; font-size:13px;">${descInner}</span>` : "";
    return `<tr><td style="padding:0 0 ${last ? "0" : "12px"} 0; vertical-align:top;">
      <table cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td valign="top" width="28" style="color:${TEAL}; font-family:${MONO}; font-size:13px; font-weight:600; padding-top:1px;">${n}</td>
        <td><strong${fa(b, `items.${oi}.title`)} style="color:${INK};">${esc(it.title)}</strong>${desc}</td>
      </tr></table></td></tr>`;
  }).join("\n");
  if (!rows && b.title === undefined) return "";
  const head = b.title !== undefined
    ? `<p${fa(b, "title")} style="text-align:${s.align}; color:${INK}; font-size:18px; font-weight:700; margin:0 0 ${b.titleNote !== undefined ? "4px" : "14px"};">${esc(b.title)}</p>` + noteHtml(b.titleNote, s.align, "0 0 14px", fa(b, "titleNote"))
    : "";
  const table = rows ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-size:14px; color:${BODY}; line-height:1.75; margin:0;">${rows}</table>` : "";
  return head + table + noteHtml(b.bottomNote, s.align, "14px 0 0", fa(b, "bottomNote"));
}
function renderAgenda(b: Block, s: Resolved): string {
  const rs = (b.rows ?? []).map((r, oi) => ({ r, oi })).filter(({ r }) => r?.time?.trim() || r?.label?.trim());
  const rows = rs.map(({ r, oi }) => `<tr>
      <td${fa(b, `rows.${oi}.time`)} style="color:${SUB}; font-family:${MONO}; font-size:13px; padding:3px 18px 3px 0; white-space:nowrap; vertical-align:top;">${esc(r.time)}</td>
      <td${fa(b, `rows.${oi}.label`)} style="padding:3px 0; vertical-align:top;">${esc(r.label)}</td>
    </tr>`).join("\n");
  if (!rows && b.title === undefined) return "";
  const head = b.title !== undefined
    ? `<p${fa(b, "title")} style="text-align:${s.align}; color:${INK}; font-size:18px; font-weight:700; margin:0 0 ${b.titleNote !== undefined ? "4px" : "14px"};">${esc(b.title)}</p>` + noteHtml(b.titleNote, s.align, "0 0 14px", fa(b, "titleNote"))
    : "";
  const table = rows ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-size:14px; color:${BODY}; line-height:1.9;">${rows}</table>` : "";
  return head + table + noteHtml(b.bottomNote, s.align, "14px 0 0", fa(b, "bottomNote"));
}
function renderImage(b: Block, s: Resolved): string {
  if (!b.url?.trim()) return noteHtml(b.title, s.align, "0 0 10px", fa(b, "title"));
  const w = b.width && b.width > 0 ? ` width="${clampWidth(b.width, 600)}"` : "";
  const head = b.title !== undefined
    ? `<p${fa(b, "title")} style="text-align:${s.align}; color:${INK}; font-size:16px; font-weight:700; margin:0 0 10px;">${esc(b.title)}</p>` : "";
  const imgTag = `<img${ia(b, "url")} src="${url(b.url)}"${w} alt="${esc(b.alt ?? "")}" style="display:block; margin:0 ${s.align === "center" ? "auto" : "0"}; border:0; max-width:100%; height:auto; border-radius:6px;">`;
  const img = b.href?.trim()
    ? `<a${la(b, "href")} href="${url(b.href)}" target="_blank" rel="noopener noreferrer" style="display:block; text-decoration:none; margin:0 ${s.align === "center" ? "auto" : "0"}; max-width:100%;">${imgTag}</a>`
    : imgTag;
  return head + img + noteHtml(b.caption, s.align, "10px 0 0", fa(b, "caption"));
}
function dividerHtml(): string {
  return `<div style="border-top:1px solid ${HAIR}; height:1px; line-height:1px;">&nbsp;</div>`;
}

// ── grid 블록 ──
function gridCardHtml(b: Block, c: GridCard, align: Align, ci: number): string {
  const P = `cards.${ci}`;
  const descF = c.descHtml !== undefined ? fa(b, `${P}.descHtml`, true) : fa(b, `${P}.desc`);
  const t = b.cardType ?? "feature";
  const pad = "16px";
  const border = `1px solid ${CARD_BORDER}`;
  if (t === "image") {
    const img = c.img?.trim()
      ? `<img${ia(b, `${P}.img`)} src="${url(c.img)}" alt="${esc(c.title ?? "")}" style="display:block; width:100%; height:auto; border-radius:8px; margin:0 0 11px; border:0;">`
      : "";
    const descInner = c.descHtml !== undefined ? sanitizeInline(c.descHtml) : c.desc?.trim() ? nl2br(c.desc) : "";
    const desc = descInner ? `<p${descF} style="margin:0; color:${SUB}; font-size:12.5px; line-height:1.6;">${descInner}</p>` : "";
    return `<div style="border:${border}; border-radius:12px; padding:${pad}; text-align:${align};">${img}${desc}</div>`;
  }
  if (t === "stat") {
    const v = c.value?.trim() ? `<p${fa(b, `${P}.value`)} style="margin:0; color:${TEAL}; font-family:${MONO}; font-size:28px; font-weight:800; line-height:1.1; text-align:${align};">${esc(c.value)}</p>` : "";
    const l = c.title?.trim() ? `<p${fa(b, `${P}.title`)} style="margin:6px 0 0; color:${SUB}; font-size:12.5px; text-align:${align};">${esc(c.title)}</p>` : "";
    return `<div style="border:${border}; border-radius:12px; padding:${pad};">${v}${l}</div>`;
  }
  if (t === "cta") {
    const title = c.title?.trim() ? `<p${fa(b, `${P}.title`)} style="margin:0; color:${INK}; font-size:15px; font-weight:700; text-align:${align};">${esc(c.title)}</p>` : "";
    const descInner = c.descHtml !== undefined ? sanitizeInline(c.descHtml) : c.desc?.trim() ? nl2br(c.desc) : "";
    const desc = descInner ? `<p${descF} style="margin:6px 0 0; color:${SUB}; font-size:12.5px; line-height:1.6; text-align:${align};">${descInner}</p>` : "";
    const moreLabel = c.btn?.trim() || "자세히";
    const more = `<p style="margin:13px 0 0; color:${TEAL}; font-size:13px; font-weight:700; text-align:${align};">${fw(b, `${P}.btn`, esc(moreLabel))} &rarr;</p>`;
    const inner = `<div style="border:${border}; border-radius:12px; padding:${pad};">${title}${desc}${more}</div>`;
    return c.url?.trim()
      ? `<a${la(b, `${P}.url`)} href="${url(c.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; display:block;">${inner}</a>`
      : inner;
  }
  // feature
  const title = c.title?.trim() ? `<p${fa(b, `${P}.title`)} style="margin:0; color:${INK}; font-size:14.5px; font-weight:700; text-align:${align};">${esc(c.title)}</p>` : "";
  const descInner = c.descHtml !== undefined ? sanitizeInline(c.descHtml) : c.desc?.trim() ? nl2br(c.desc) : "";
  const desc = descInner ? `<p${descF} style="margin:6px 0 0; color:${SUB}; font-size:12.5px; line-height:1.6; text-align:${align};">${descInner}</p>` : "";
  return `<div style="border:${border}; border-radius:12px; padding:${pad}; text-align:${align};">${title}${desc}</div>`;
}
function renderGrid(b: Block): string {
  const cards = b.cards ?? [];
  if (!cards.length) return "";
  const cols = b.cols === 3 ? 3 : 2;
  const align: Align = b.cardAlign ?? (b.cardType === "stat" ? "center" : b.cardType === "cta" ? "center" : "left");
  const wPct = cols === 3 ? "33.33%" : "50%";
  // 반응형: 작은 화면에서 1열 stack (지원 클라이언트). 미지원 시 셀 비율 유지.
  const cells = cards.map((c, ci) =>
    `<td class="eb-col" width="${wPct}" style="width:${wPct}; vertical-align:top; padding:7px;">${gridCardHtml(b, c, align, ci)}</td>`
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
  return `<tr><td${ANNOTATE ? ` data-eb-b="${b.id}"` : ""} style="padding:${gapY}px ${padX}px;">${inner}</td></tr>`;
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
  const showOrgName = footer?.showOrgName !== false;
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

  const senderParts = [
    showOrgName ? esc(orgName) : "",
    showInquiry ? `문의: <a href="mailto:${esc(email)}" style="color:${MUTED}; text-decoration:underline;">${esc(email)}</a>` : "",
    address ? esc(address) : "",
  ].filter(Boolean);
  const senderLine = senderParts.length
    ? `<p style="color:${MUTED}; font-size:11px; line-height:1.6; margin:0 0 4px 0;">
      ${senderParts.join(" · ")}
    </p>`
    : "";

  const unsubLine = showUnsub ? `<p style="color:${MUTED}; font-size:11px; line-height:1.6; margin:0 0 12px 0;">
      이 메일을 더 이상 받고 싶지 않으시면 <a href="${UNSUB_PLACEHOLDER}" style="color:${MUTED}; text-decoration:underline;">수신거부</a> 하실 수 있습니다.
    </p>` : "";

  return `<tr><td style="padding:48px 0 0 0; text-align:center;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 20px 0;"><tr><td style="border-top:1px solid ${HAIR};"></td></tr></table>
    ${social}
    <p style="margin:0 0 8px 0;">
      <a target="_blank" rel="noopener noreferrer" href="${url(brand.email.footerLogo.link)}" style="display:inline-block; text-decoration:none;"><img src="${FOOTER_LOGO}" width="${brand.email.footerLogo.width}" height="${brand.email.footerLogo.height}" alt="${esc(brand.email.footerLogo.alt)}" style="display:block; border:0; margin:0 auto;"></a>
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

/** spec → <body> 안에 들어갈 본문 HTML. annotate=true 는 스튜디오 미리보기 전용 (data-eb-* 속성 추가). */
export function renderTemplate(spec: TemplateSpec, opts: { annotate?: boolean } = {}): string {
  ANNOTATE = !!opts.annotate;
  try {
    return renderTemplateInner(spec);
  } finally {
    ANNOTATE = false;
  }
}

function renderTemplateInner(spec: TemplateSpec): string {
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
