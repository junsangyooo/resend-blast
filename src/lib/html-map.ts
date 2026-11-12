/**
 * Source ↔ preview mapping for the studio editor (client-safe, pure).
 *
 * Parses email HTML with parse5 (spec-compliant, with source offsets) and produces a preview copy where
 *  - every source element gets data-eb-e="<index>" (click in preview → its range in the code),
 *  - optionally every non-blank text node is wrapped in <span data-eb-t="<index>"> (edit in preview →
 *    replace exactly that range in the source).
 * The source itself is never reformatted; edits are applied as precise range replacements.
 */
import { parseFragment } from "parse5";

export type Range = { start: number; end: number };
export type HtmlMap = {
  /** Element ranges (whole element, start tag → end tag) in document order. */
  elements: (Range & { tag: string; startTagEnd: number })[];
  /** Editable text ranges (trimmed core of each non-blank text node). */
  texts: Range[];
};

const NO_TEXT_WRAP_PARENTS = new Set([
  "style", "script", "title", "textarea", "noscript", "template", "option", "select",
  "table", "tbody", "thead", "tfoot", "tr", "colgroup",
]);

type P5Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: P5Node[];
  content?: P5Node;
  sourceCodeLocation?: {
    startOffset: number; endOffset: number;
    startTag?: { startOffset: number; endOffset: number };
  } | null;
};

function walk(src: string, opts: { wrapText: boolean }): {
  map: HtmlMap;
  inserts: { at: number; text: string; order: number }[];
} {
  const root = parseFragment(src, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  const map: HtmlMap = { elements: [], texts: [] };
  const inserts: { at: number; text: string; order: number }[] = [];
  let seq = 0;

  const visit = (node: P5Node, parentTag: string) => {
    const loc = node.sourceCodeLocation;
    if (node.nodeName === "#text") {
      if (!opts.wrapText || !loc || NO_TEXT_WRAP_PARENTS.has(parentTag)) return;
      const raw = src.slice(loc.startOffset, loc.endOffset);
      // Skip text that renders as nothing visible: whitespace, &nbsp; spacers (dividers), zero-width hacks.
      if (!String(node.value ?? "").replace(/[\u200b-\u200d\u2060\ufeff\u034f\u00ad]/g, "").trim()) return;
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const start = loc.startOffset + lead;
      const end = loc.endOffset - trail;
      const k = map.texts.length;
      map.texts.push({ start, end });
      inserts.push({ at: start, text: `<span data-eb-t="${k}">`, order: seq++ });
      inserts.push({ at: end, text: `</span>`, order: -(seq++) });
      return;
    }
    const isWrapper = (node as any).attrs?.some((a: any) => a.name === "data-eb-w");
    if (node.tagName && loc && loc.startTag && !isWrapper) {
      const k = map.elements.length;
      map.elements.push({ start: loc.startOffset, end: loc.endOffset, tag: node.tagName, startTagEnd: loc.startTag.endOffset });
      // Insert the attribute right after "<tagname".
      inserts.push({ at: loc.startTag.startOffset + 1 + node.tagName.length, text: ` data-eb-e="${k}"`, order: seq++ });
    }
    const kids = node.nodeName === "template" && node.content ? node.content.childNodes : node.childNodes;
    for (const c of kids ?? []) visit(c, node.tagName ?? parentTag);
  };
  for (const c of root.childNodes ?? []) visit(c, "");
  return { map, inserts };
}

/** Build the annotated preview copy + the range map for `src`. */
export function annotateHtml(src: string, opts: { wrapText: boolean }): { html: string; map: HtmlMap } {
  const { map, inserts } = walk(src, opts);
  // Apply from the end so earlier offsets stay valid. At the same offset: closing spans (negative order)
  // must come before the next element's/span's opening insertions.
  inserts.sort((a, b) => b.at - a.at || a.order - b.order);
  let out = src;
  for (const ins of inserts) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  return { html: out, map };
}

/** Element ranges only (used for read-only code views). */
export function elementRanges(src: string): HtmlMap["elements"] {
  return walk(src, { wrapText: false }).map.elements;
}

/** Remove editor-only data-eb-* attributes (used on the annotated block render, which has no text wrappers). */
export function stripAnnotations(html: string): string {
  return html
    // editor-only wrapper spans around plain text (lib/blocks fw): unwrap entirely
    .replace(/<span data-eb-w="1"[^>]*>([^<]*)<\/span>/g, "$1")
    .replace(/ data-eb-[a-z]+="[^"]*"/g, "");
}

/** Escape plain text for insertion into HTML source (keeps NBSP visible as &nbsp;). */
export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
}

/**
 * Replace text range k with `text` (escaped) and shift every later offset in place, so the map stays
 * valid without re-parsing (the preview keeps its caret while typing).
 */
export function replaceTextRange(src: string, map: HtmlMap, k: number, text: string): string {
  const r = map.texts[k];
  if (!r) return src;
  const next = escapeText(text);
  const delta = next.length - (r.end - r.start);
  const out = src.slice(0, r.start) + next + src.slice(r.end);
  shift(map, r.start, r.end, delta, r);
  r.end = r.start + next.length;
  return out;
}

/** Set (or add) attribute `name` on element k. Returns the new source; the map is shifted in place. */
export function setElementAttr(src: string, map: HtmlMap, k: number, name: string, value: string): string {
  const el = map.elements[k];
  if (!el) return src;
  const tag = src.slice(el.start, el.startTagEnd);
  const esc = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  const nextTag = re.test(tag)
    ? tag.replace(re, (_m, pre: string) => `${pre}"${esc}"`)
    : tag.replace(/\s*\/?>$/, (m) => ` ${name}="${esc}"${m.trim() === "/>" ? " />" : ">"}`);
  const delta = nextTag.length - tag.length;
  const out = src.slice(0, el.start) + nextTag + src.slice(el.startTagEnd);
  shift(map, el.start, el.startTagEnd, delta);
  return out;
}

/** Read attribute `name` of element k from the source (unescaped minimally). */
export function getElementAttr(src: string, map: HtmlMap, k: number, name: string): string {
  const el = map.elements[k];
  if (!el) return "";
  const tag = src.slice(el.start, el.startTagEnd);
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const v = m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
  return v.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** After replacing [from, to) with something `delta` chars longer, shift all ranges (`self` is updated by the caller). */
function shift(map: HtmlMap, from: number, to: number, delta: number, self?: Range) {
  if (!delta) return;
  const mv = (n: number) => (n >= to ? n + delta : n);
  for (const t of map.texts) {
    if (t === self) continue;
    if (t.start >= to) { t.start += delta; t.end += delta; }
  }
  for (const e of map.elements) {
    // Elements containing the edited range grow; later ones move.
    if (e.start <= from && e.end >= to) { e.end += delta; if (e.startTagEnd >= to) e.startTagEnd += delta; }
    else { e.start = mv(e.start); e.end = mv(e.end); e.startTagEnd = mv(e.startTagEnd); }
  }
}

// ── preheader (hidden inbox-preview text) in HTML emails ─────────────────────────────

const PREHEADER_STYLE = "display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#f5f5f5;";
const INVISIBLE = /[​-‍⁠﻿͏­ ]/g;

/** Spacer sequences put after preheader text to keep the body from leaking into the inbox preview. */
const SPACER_START = /(&zwnj;|&#8204;|&#x200c;|\u200c|&#847;|&#x34f;|\u034f|&shy;|&#173;|\u00ad|(&nbsp;|&#160;|\u00a0)\s*(&zwnj;|&#8204;|\u200c))/i;

/**
 * The preheader of an HTML email = the first display:none element, before any visible text, that has text.
 * Only its visible text is edited (start..end); trailing spacer characters and other children are kept.
 */
export function findPreheader(src: string): { start: number; end: number; text: string } | null {
  const root = parseFragment(src, { sourceCodeLocationInfo: true }) as unknown as any;
  let found: { start: number; end: number; text: string } | null = null;
  let visibleSeen = false;
  const firstText = (n: any): any => {
    for (const c of n.childNodes ?? []) {
      if (c.nodeName === "#text" && String(c.value ?? "").replace(INVISIBLE, "").trim() && c.sourceCodeLocation) return c;
      const d = c.tagName ? firstText(c) : null;
      if (d) return d;
    }
    return null;
  };
  const visit = (n: any): void => {
    if (found || visibleSeen) return;
    if (n.nodeName === "#text") {
      if (String(n.value ?? "").replace(INVISIBLE, "").trim()) visibleSeen = true;
      return;
    }
    if (n.tagName === "style" || n.tagName === "script" || n.tagName === "title") return;
    const style = (n.attrs ?? []).find((a: any) => a.name === "style")?.value ?? "";
    if (n.tagName && /display\s*:\s*none/i.test(style)) {
      const t = firstText(n);
      if (!t) return; // hidden but textless (e.g. a tracking pixel) — not a preheader, not visible text either
      const loc = t.sourceCodeLocation;
      const raw = src.slice(loc.startOffset, loc.endOffset);
      const lead = raw.length - raw.trimStart().length;
      const sp = raw.search(SPACER_START);
      // The edit range runs up to the spacers (trailing whitespace included), so a typed trailing space is replaced, not duplicated.
      const end = loc.startOffset + Math.max(lead, sp === -1 ? raw.length : sp);
      found = { start: loc.startOffset + lead, end, text: decode(src.slice(loc.startOffset + lead, end)) };
      return;
    }
    for (const c of n.childNodes ?? []) visit(c);
  };
  for (const c of root.childNodes ?? []) visit(c);
  return found;
}

function decode(s: string): string {
  const frag = parseFragment(`<b>${s}</b>`) as unknown as any;
  const b = frag.childNodes?.[0];
  return (b?.childNodes ?? []).map((c: any) => c.value ?? "").join("").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

/** Set the preheader text: replace only its visible text in place, or insert a hidden element at the very top. */
export function setPreheader(src: string, text: string): string {
  // Keep the text as typed (spaces included) — trimming on every keystroke would eat the space being typed.
  const cur = findPreheader(src);
  if (cur) return src.slice(0, cur.start) + escapeText(text) + src.slice(cur.end);
  if (!text.trim()) return src;
  return `<div style="${PREHEADER_STYLE}">${escapeText(text)}</div>\n` + src;
}

/**
 * HTML emails: carry hand text edits made while the AI was working (base → current) over to the AI result.
 * Only plain text-node edits can be carried; each is re-applied where the AI result still has the original
 * text exactly once. `missed` counts edits that could not be placed (structural edits count as one).
 */
export function carryTextEdits(base: string, current: string, ai: string): { html: string; carried: number; missed: number } {
  if (base === current) return { html: ai, carried: 0, missed: 0 };
  const bm = annotateHtml(base, { wrapText: true }).map;
  const cm = annotateHtml(current, { wrapText: true }).map;
  if (bm.texts.length !== cm.texts.length) return { html: ai, carried: 0, missed: 1 };
  const edits: { from: string; to: string }[] = [];
  bm.texts.forEach((t, i) => {
    const from = base.slice(t.start, t.end);
    const to = current.slice(cm.texts[i].start, cm.texts[i].end);
    if (from !== to) edits.push({ from, to });
  });
  // Anything besides text edits (attributes, code edits) → not carried.
  let rebuilt = base;
  for (let i = bm.texts.length - 1; i >= 0; i--) {
    const t = bm.texts[i];
    rebuilt = rebuilt.slice(0, t.start) + current.slice(cm.texts[i].start, cm.texts[i].end) + rebuilt.slice(t.end);
  }
  const structural = rebuilt !== current ? 1 : 0;
  let html = ai;
  let carried = 0;
  let missed = structural;
  for (const e of edits) {
    const am = annotateHtml(html, { wrapText: true }).map;
    const hits = am.texts.filter((t) => html.slice(t.start, t.end) === e.from);
    if (hits.length !== 1) { missed++; continue; }
    html = html.slice(0, hits[0].start) + e.to + html.slice(hits[0].end);
    carried++;
  }
  return { html, carried, missed };
}
