import { describe, it, expect } from "vitest";
import { validateSpec } from "./spec-validate";
import { renderTemplate } from "../blocks";

const okSpec = {
  subject: "테스트", showLogo: true, showFooter: true,
  blocks: [
    { type: "heading", text: "안녕" },
    { type: "text", html: "본문 {{name|친구}}" },
    { type: "button", label: "신청", url: "https://x.com" },
    { type: "grid", cols: 2, cardType: "stat", cards: [{ value: "1", title: "a" }] },
  ],
};

describe("validateSpec", () => {
  it("accepts a valid spec and fills ids", () => {
    const r = validateSpec(okSpec);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.blocks).toHaveLength(4);
      expect(new Set(r.spec.blocks.map(b => b.id)).size).toBe(4);
    }
  });
  it("rejects non-object / missing subject / empty blocks", () => {
    expect(validateSpec(null).ok).toBe(false);
    expect(validateSpec({ ...okSpec, subject: "" }).ok).toBe(false);
    expect(validateSpec({ ...okSpec, blocks: [] }).ok).toBe(false);
  });
  it("rejects unknown block type and bad enum", () => {
    expect(validateSpec({ ...okSpec, blocks: [{ type: "video" }] }).ok).toBe(false);
    expect(validateSpec({ ...okSpec, blocks: [{ type: "text", text: "a", align: "middle" }] }).ok).toBe(false);
  });
  it("rejects unsafe urls", () => {
    const r = validateSpec({ ...okSpec, blocks: [{ type: "button", label: "x", url: "javascript:alert(1)" }] });
    expect(r.ok).toBe(false);
  });
  it("rejects >100 blocks", () => {
    const many = Array.from({ length: 101 }, () => ({ type: "divider" }));
    expect(validateSpec({ ...okSpec, blocks: many }).ok).toBe(false);
  });
  it("rejects unsafe logo url", () => {
    const r = validateSpec({ ...okSpec, logo: { url: "javascript:alert(1)" } });
    expect(r.ok).toBe(false);
  });
  it("accepts safe logo url and preserves it", () => {
    const r = validateSpec({ ...okSpec, logo: { url: "https://x/logo.png", width: 130 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.logo).toEqual({ url: "https://x/logo.png", width: 130 });
    }
  });
  it("strips unknown fields and coerces width token", () => {
    const r = validateSpec({ ...okSpec, width: "wide", evil: 1, blocks: [{ type: "text", text: "a", hax: true }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.spec as any).evil).toBeUndefined();
      expect((r.spec.blocks[0] as any).hax).toBeUndefined();
      expect(r.spec.width).toBe("wide");
    }
  });
  it("sanitizes rich html content (XSS)", () => {
    const r = validateSpec({ ...okSpec, blocks: [
      { type: "text", html: '<img src=x onerror=alert(1)>안녕<strong>b</strong>' },
      { type: "numbered", items: [{ title: "t", descHtml: '<script>x</script><u>u</u>' }] },
      { type: "grid", cols: 2, cardType: "feature", cards: [{ title: "c", descHtml: '<div onclick=x>d</div>' }] },
    ]});
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [t, n, g] = r.spec.blocks as any[];
      expect(t.html).not.toContain("onerror"); expect(t.html).toContain("<strong>b</strong>");
      expect(n.items[0].descHtml).not.toContain("script"); expect(n.items[0].descHtml).toContain("<u>u</u>");
      expect(g.cards[0].descHtml).not.toContain("onclick"); expect(g.cards[0].descHtml).toContain("d");
    }
  });
  it("does not double-escape entities across validate + render (round-trip)", () => {
    const r = validateSpec({ ...okSpec, blocks: [{ type: "text", html: "Q&A 세션" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const html = renderTemplate(r.spec);
      expect(html).toContain("Q&amp;A");
      expect(html).not.toContain("&amp;amp;");
    }
  });
});
