import { describe, it, expect } from "vitest";
import { annotateHtml, elementRanges, stripAnnotations, replaceTextRange, setElementAttr, getElementAttr } from "./html-map";

const SRC = `<table width="100%"><tr><td style="padding:4px">
  Hello <b>{{name}}</b> &amp; team
</td></tr></table>
<p><a href="https://a.com">Go</a></p>
<img src="x.png" alt="pic">`;

describe("html-map", () => {
  it("annotates elements and wraps text without changing the rest", () => {
    const { html, map } = annotateHtml(SRC, { wrapText: true });
    expect(map.texts.map((t) => SRC.slice(t.start, t.end))).toEqual(["Hello", "{{name}}", "&amp; team", "Go"]);
    expect(stripAnnotations(annotateHtml(SRC, { wrapText: false }).html)).toBe(SRC);
    expect(html).toContain('<b data-eb-e="');
    expect(html).toContain('<span data-eb-t="0">Hello</span>');
    // element ranges cover the real source
    const a = map.elements.find((e) => e.tag === "a")!;
    expect(SRC.slice(a.start, a.end)).toBe('<a href="https://a.com">Go</a>');
  });

  it("does not wrap invisible spacer text (&nbsp;, zero-width)", () => {
    const src = `<div style="border-top:1px solid #eee">&nbsp;</div><span>&zwnj;&nbsp;&zwnj;</span><p>Hi</p>`;
    const { map } = annotateHtml(src, { wrapText: true });
    expect(map.texts.map((t) => src.slice(t.start, t.end))).toEqual(["Hi"]);
  });

  it("does not wrap text inside style", () => {
    const src = `<style>.x{}</style><table><tr><td>ok</td></tr></table>`;
    const { map } = annotateHtml(src, { wrapText: true });
    expect(map.texts.map((t) => src.slice(t.start, t.end))).toEqual(["ok"]);
  });

  it("replaces a text range and keeps later ranges valid", () => {
    const { map } = annotateHtml(SRC, { wrapText: true });
    let s = replaceTextRange(SRC, map, 0, "Hi <there>");
    expect(s).toContain("Hi &lt;there&gt; <b>");
    s = replaceTextRange(s, map, 3, "Go now");
    expect(s).toContain('<a href="https://a.com">Go now</a>');
    const a = map.elements.find((e) => e.tag === "a")!;
    expect(s.slice(a.start, a.end)).toBe('<a href="https://a.com">Go now</a>');
  });

  it("sets and reads attributes", () => {
    const { map } = annotateHtml(SRC, { wrapText: true });
    const ai = map.elements.findIndex((e) => e.tag === "a");
    const ii = map.elements.findIndex((e) => e.tag === "img");
    let s = setElementAttr(SRC, map, ai, "href", "https://b.com/?q=1&x=2");
    expect(getElementAttr(s, map, ai, "href")).toBe("https://b.com/?q=1&x=2");
    s = setElementAttr(s, map, ii, "src", "https://cdn/y.png");
    expect(s).toContain('<img src="https://cdn/y.png" alt="pic">');
    expect(getElementAttr(s, map, ii, "alt")).toBe("pic");
  });

  it("element order matches between annotated and clean renders", () => {
    const clean = elementRanges(SRC).map((e) => e.tag);
    const ann = elementRanges(annotateHtml(SRC, { wrapText: false }).html).map((e) => e.tag);
    expect(ann).toEqual(clean);
  });
});

import { findPreheader, setPreheader } from "./html-map";
describe("preheader", () => {
  const withPre = `<style>.x{}</style><div style="margin:0"><div style="display:none; max-height:0;">Quick reminder &amp; more&zwnj;&nbsp;&zwnj;&nbsp;</div><p>Hi</p></div>`;
  it("finds the leading hidden text", () => {
    expect(findPreheader(withPre)?.text).toBe("Quick reminder & more");
    expect(findPreheader(`<p>Hi</p><div style="display:none">late</div>`)).toBeNull();
  });
  it("edits in place or inserts", () => {
    const edited = setPreheader(withPre, "New <text>");
    expect(edited).toContain('<div style="display:none; max-height:0;">New &lt;text&gt;&zwnj;&nbsp;&zwnj;&nbsp;</div><p>Hi</p>');
    const inserted = setPreheader("<p>Hi</p>", "Preview");
    expect(findPreheader(inserted)?.text).toBe("Preview");
    expect(inserted.endsWith("<p>Hi</p>")).toBe(true);
    expect(setPreheader("<p>Hi</p>", "  ")).toBe("<p>Hi</p>");
    // typing keeps spaces (a trailing space must survive until the next character)
    const typed = setPreheader(withPre, "Hello ");
    expect(typed).toContain(">Hello &zwnj;");
    expect(setPreheader(typed, "Hello w")).toContain(">Hello w&zwnj;");
  });
});

describe("audit fixes", () => {
  it("clearing a text and typing again stays in place", () => {
    const src = "<p>Hello</p><p>World</p>";
    const { map } = annotateHtml(src, { wrapText: true });
    let s = replaceTextRange(src, map, 0, "");
    s = replaceTextRange(s, map, 0, "H");
    s = replaceTextRange(s, map, 0, "Hi");
    expect(s).toBe("<p>Hi</p><p>World</p>");
    s = replaceTextRange(s, map, 1, "Earth");
    expect(s).toBe("<p>Hi</p><p>Earth</p>");
  });
  it("attribute values with $ are kept literally", () => {
    const src = '<a href="x">Go</a>';
    const { map } = annotateHtml(src, { wrapText: true });
    const s = setElementAttr(src, map, 0, "href", "https://a.com/?q=$&z=$1");
    expect(getElementAttr(s, map, 0, "href")).toBe("https://a.com/?q=$&z=$1");
  });
  it("preheader edit keeps spacers and other children; skips textless hidden elements", () => {
    const src = `<div style="display:none"><img src="p.gif"></div><div style="display:none">Old text&zwnj;&nbsp;&zwnj;&nbsp;</div><p>Body</p>`;
    expect(findPreheader(src)?.text).toBe("Old text");
    const s = setPreheader(src, "New");
    expect(s).toBe(`<div style="display:none"><img src="p.gif"></div><div style="display:none">New&zwnj;&nbsp;&zwnj;&nbsp;</div><p>Body</p>`);
  });
});

import { carryTextEdits } from "./html-map";
describe("carryTextEdits (HTML email, hand edits during the AI run)", () => {
  const base = "<h1>Title</h1><p>Body text</p>";
  it("re-applies a hand text edit on the AI result", () => {
    const current = "<h1>Title!</h1><p>Body text</p>";
    const ai = '<h1>Title</h1><p style="color:red">Body text</p><p>New</p>';
    expect(carryTextEdits(base, current, ai)).toEqual({ html: '<h1>Title!</h1><p style="color:red">Body text</p><p>New</p>', carried: 1, missed: 0 });
  });
  it("counts edits it cannot place (AI rewrote that text, or structural edits)", () => {
    expect(carryTextEdits(base, "<h1>Title!</h1><p>Body text</p>", "<h1>Other</h1>").missed).toBe(1);
    expect(carryTextEdits(base, '<h1 class="x">Title</h1><p>Body text</p>', base).missed).toBe(1);
  });
});
