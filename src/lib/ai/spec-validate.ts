// Schema validation + sanitizing of the AI output spec (copy allowed fields only, guarantee ids). Pure function.
import { type Block, type BlockType, type GridCard, type TemplateSpec, newId, sanitizeInline } from "../blocks";

const TYPES = new Set<BlockType>(["heading","text","button","badge","kicker","numbered","agenda","grid","image","divider"]);
const ALIGN = new Set(["left","center","right"]);
const SIZE = new Set(["S","M","L"]);
const GAP = new Set(["tight","sm","lg",""]);
const COLOR = new Set(["ink","body","teal","muted",""]);
const WEIGHT = new Set(["bold","normal",""]);
const FONT = new Set(["sans","mono",""]);
const BTNCOLOR = new Set(["mint","teal","ink",""]);
const CARDTYPE = new Set(["feature","image","stat","cta"]);
const URL_RE = /^(https?:\/\/|mailto:)/i;

type Errs = string[];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

function takeEnum(errs: Errs, path: string, v: unknown, set: Set<string>): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !set.has(v)) { errs.push(`${path}: 허용되지 않는 값 "${String(v)}"`); return undefined; }
  return v;
}
function takeUrl(errs: Errs, path: string, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (!URL_RE.test(s)) { errs.push(`${path}: URL 은 http(s):// 또는 mailto: 만 허용`); return undefined; }
  return s;
}

function cleanCard(errs: Errs, path: string, c: any): GridCard {
  if (!c || typeof c !== "object") { errs.push(`${path}: 카드가 객체가 아님`); return {}; }
  return {
    title: str(c.title), desc: str(c.desc),
    descHtml: c.descHtml !== undefined && typeof c.descHtml === "string" ? sanitizeInline(c.descHtml) : undefined,
    img: takeUrl(errs, `${path}.img`, c.img), value: str(c.value),
    btn: str(c.btn), url: takeUrl(errs, `${path}.url`, c.url),
  };
}

function cleanBlock(errs: Errs, i: number, raw: any): Block | null {
  const p = `blocks[${i}]`;
  if (!raw || typeof raw !== "object") { errs.push(`${p}: 블록이 객체가 아님`); return null; }
  if (!TYPES.has(raw.type)) { errs.push(`${p}.type: 알 수 없는 블록 타입 "${String(raw.type)}"`); return null; }
  const b: Block = { id: typeof raw.id === "string" && raw.id ? raw.id : newId(), type: raw.type };
  b.align = takeEnum(errs, `${p}.align`, raw.align, ALIGN) as Block["align"];
  b.gap = takeEnum(errs, `${p}.gap`, raw.gap, GAP) as Block["gap"];
  b.size = takeEnum(errs, `${p}.size`, raw.size, SIZE) as Block["size"];
  b.weight = takeEnum(errs, `${p}.weight`, raw.weight, WEIGHT) as Block["weight"];
  b.font = takeEnum(errs, `${p}.font`, raw.font, FONT) as Block["font"];
  b.color = takeEnum(errs, `${p}.color`, raw.color, COLOR) as Block["color"];
  b.text = str(raw.text);
  b.html = raw.html !== undefined && typeof raw.html === "string" ? sanitizeInline(raw.html) : undefined;
  b.subnote = str(raw.subnote);
  b.label = str(raw.label); b.url = takeUrl(errs, `${p}.url`, raw.url);
  b.topNote = str(raw.topNote); b.bottomNote = str(raw.bottomNote);
  b.arrow = bool(raw.arrow);
  b.btnColor = takeEnum(errs, `${p}.btnColor`, raw.btnColor, BTNCOLOR) as Block["btnColor"];
  b.line1 = str(raw.line1); b.line2 = str(raw.line2);
  b.line2Href = takeUrl(errs, `${p}.line2Href`, raw.line2Href);
  b.title = str(raw.title); b.titleNote = str(raw.titleNote);
  b.alt = str(raw.alt); b.caption = str(raw.caption);
  b.href = takeUrl(errs, `${p}.href`, raw.href);
  b.fullBleed = bool(raw.fullBleed);
  if (raw.width !== undefined) {
    const n = Number(raw.width);
    if (!Number.isFinite(n) || n < 1 || n > 1200) errs.push(`${p}.width: 1~1200 숫자만`);
    else b.width = Math.round(n);
  }
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items)) errs.push(`${p}.items: 배열이어야 함`);
    else b.items = raw.items.map((it: any, j: number) =>
      it && typeof it === "object"
        ? {
            title: str(it.title) ?? "", desc: str(it.desc),
            descHtml: it.descHtml !== undefined && typeof it.descHtml === "string" ? sanitizeInline(it.descHtml) : undefined,
          }
        : (errs.push(`${p}.items[${j}]: 객체가 아님`), { title: "" }));
  }
  if (raw.rows !== undefined) {
    if (!Array.isArray(raw.rows)) errs.push(`${p}.rows: 배열이어야 함`);
    else b.rows = raw.rows.map((r: any, j: number) =>
      r && typeof r === "object"
        ? { time: str(r.time) ?? "", label: str(r.label) ?? "" }
        : (errs.push(`${p}.rows[${j}]: 객체가 아님`), { time: "", label: "" }));
  }
  if (raw.cols !== undefined) {
    if (raw.cols !== 2 && raw.cols !== 3) errs.push(`${p}.cols: 2 또는 3만 허용`);
    else b.cols = raw.cols;
  }
  b.cardType = takeEnum(errs, `${p}.cardType`, raw.cardType, CARDTYPE) as Block["cardType"];
  b.cardAlign = takeEnum(errs, `${p}.cardAlign`, raw.cardAlign, ALIGN) as Block["cardAlign"];
  if (raw.cards !== undefined) {
    if (!Array.isArray(raw.cards)) errs.push(`${p}.cards: 배열이어야 함`);
    else b.cards = raw.cards.map((c: any, j: number) => cleanCard(errs, `${p}.cards[${j}]`, c));
  }
  // Strip undefined fields (avoids noise when saving JSON)
  for (const k of Object.keys(b) as (keyof Block)[]) if (b[k] === undefined) delete b[k];
  return b;
}

export type ValidateResult = { ok: true; spec: TemplateSpec } | { ok: false; errors: string[] };

export function validateSpec(input: unknown): ValidateResult {
  const errs: Errs = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["spec 이 JSON 객체가 아님"] };
  const raw = input as any;
  const subject = str(raw.subject)?.trim();
  if (!subject) errs.push("subject: 비어 있지 않은 문자열 필수");
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) errs.push("blocks: 1개 이상 필수");
  else if (raw.blocks.length > 100) errs.push("blocks: 최대 100개");
  const width = raw.width === "wide" ? "wide" : raw.width === "default" || raw.width === undefined ? raw.width : undefined;
  if (raw.width !== undefined && width === undefined) errs.push(`width: "default" 또는 "wide" 만 허용`);

  const blocks: Block[] = [];
  if (Array.isArray(raw.blocks) && raw.blocks.length <= 100) {
    const seen = new Set<string>();
    for (let i = 0; i < raw.blocks.length; i++) {
      const b = cleanBlock(errs, i, raw.blocks[i]);
      if (b) { if (seen.has(b.id)) b.id = newId(); seen.add(b.id); blocks.push(b); }
    }
  }
  const logoUrl = raw.logo && typeof raw.logo === "object" ? takeUrl(errs, "logo.url", raw.logo.url) : undefined;
  if (errs.length) return { ok: false, errors: errs };

  const f = raw.footer && typeof raw.footer === "object" ? raw.footer : undefined;
  const spec: TemplateSpec = {
    subject: subject!,
    preheader: str(raw.preheader),
    width: width as TemplateSpec["width"],
    showLogo: bool(raw.showLogo) ?? true,
    showFooter: bool(raw.showFooter) ?? true,
    tagline: str(raw.tagline),
    logo: logoUrl
      ? { url: logoUrl, width: typeof raw.logo.width === "number" ? raw.logo.width : undefined, alt: str(raw.logo.alt) }
      : undefined,
    footer: f ? {
      inquiryEmail: str(f.inquiryEmail), showInquiry: bool(f.showInquiry), showOrgName: bool(f.showOrgName), showSocial: bool(f.showSocial),
      showUnsubscribe: bool(f.showUnsubscribe), orgName: str(f.orgName), address: str(f.address),
    } : undefined,
    blocks,
  };
  for (const k of Object.keys(spec) as (keyof TemplateSpec)[]) if (spec[k] === undefined) delete (spec as any)[k];
  return { ok: true, spec };
}
