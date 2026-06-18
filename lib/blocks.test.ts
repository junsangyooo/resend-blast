import { describe, it, expect } from "vitest";
import {
  renderTemplate, migrateSpec, sanitizeInline,
  fillPlaceholders, previewFill, usesPersonalization,
  UNSUB_PLACEHOLDER, type TemplateSpec, type Block,
} from "./blocks";
import { brand } from "../brand.config";

const TEAL = brand.email.colors.teal;
const MINT = brand.email.colors.mint;

let seq = 0;
function mk(type: any, props: Partial<Block> = {}): Block {
  seq += 1;
  return { id: `t${seq}`, type, ...props } as Block;
}
const base = (blocks: Block[]): TemplateSpec => ({
  subject: "테스트 제목",
  showLogo: true,
  showFooter: true,
  blocks,
});

describe("renderTemplate (flat model)", () => {
  it("wraps content in a 600px centered table on #f5f5f5", () => {
    const html = renderTemplate(base([mk("text", { text: "안녕" })]));
    expect(html).toContain("background-color:#f5f5f5");
    expect(html).toContain('width="600"');
    expect(html).toContain("안녕");
  });

  it("renders logo header when showLogo is true and omits it when false", () => {
    const withLogo = renderTemplate(base([mk("text", { text: "x" })]));
    expect(withLogo).toContain("rldx-1-logo.png");
    const noLogo = renderTemplate({ ...base([mk("text", { text: "x" })]), showLogo: false });
    expect(noLogo).not.toContain("rldx-1-logo.png");
  });

  it("tagline under logo is optional (shown only when set)", () => {
    const none = renderTemplate(base([mk("text", { text: "x" })]));
    expect(none).not.toContain("로봇 손을 위한 모델");
    const withTag = renderTemplate({ ...base([mk("text", { text: "x" })]), tagline: "로봇 손을 위한 모델" });
    expect(withTag).toContain("로봇 손을 위한 모델");
  });

  it("top heading: mono large; kicker teal; mint button with url; badge", () => {
    const html = renderTemplate(base([
      mk("kicker", { text: "You're invited" }),
      mk("heading", { text: "Dexterity Night\nin Seoul" }),
      mk("badge", { line1: "2026.6.10", line2: "라움아트센터" }),
      mk("text", { text: "한 줄" }),
      mk("button", { label: "참석 신청", url: "https://seoul-event-form.rlwrld.co" }),
    ]));
    expect(html).toContain("You&#39;re invited");
    expect(html).toMatch(/font-family:Menlo/i);
    expect(html).toContain(TEAL);
    expect(html).toContain(MINT);
    expect(html).toContain("https://seoul-event-form.rlwrld.co");
    expect(html).toContain("Dexterity Night<br>in Seoul");
    expect(html).toContain("2026.6.10");
  });

  it("heading subnote renders as a small note when present", () => {
    const html = renderTemplate(base([mk("heading", { text: "제목", subnote: "작은 부제" })]));
    expect(html).toContain("제목");
    expect(html).toContain("작은 부제");
  });

  it("numbered list auto-numbers items 01, 02, 03", () => {
    const html = renderTemplate(base([
      mk("numbered", { items: [{ title: "A" }, { title: "B", desc: "설명" }, { title: "C" }] }),
    ]));
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
    expect(html).toContain(">03<");
    expect(html).toContain("설명");
  });

  it("agenda renders time/label rows", () => {
    const html = renderTemplate(base([mk("agenda", { rows: [{ time: "4:00 PM", label: "오프닝" }] })]));
    expect(html).toContain("4:00 PM");
    expect(html).toContain("오프닝");
  });

  it("image outputs img with src + caption + alt", () => {
    const html = renderTemplate(base([mk("image", { url: "https://x.com/a.png", alt: "그림", caption: "캡션" })]));
    expect(html).toContain("https://x.com/a.png");
    expect(html).toContain("캡션");
    expect(html).toContain('alt="그림"');
  });

  it("grid renders feature cards with title/desc", () => {
    const html = renderTemplate(base([
      mk("grid", { cols: 2, cardType: "feature", cards: [{ title: "카드A", desc: "설명A" }, { title: "카드B" }] }),
    ]));
    expect(html).toContain("카드A");
    expect(html).toContain("설명A");
    expect(html).toContain("카드B");
  });

  it("grid cta card wraps card in an anchor when url set", () => {
    const html = renderTemplate(base([
      mk("grid", { cols: 2, cardType: "cta", cards: [{ title: "신청", desc: "지금", url: "https://a.b" }] }),
    ]));
    expect(html).toContain("https://a.b");
    expect(html).toContain("자세히");
  });

  it("grid cta card uses custom btn label when set", () => {
    const html = renderTemplate(base([
      mk("grid", { cols: 2, cardType: "cta", cards: [{ title: "신청", desc: "지금", btn: "신청하기", url: "https://a.b" }] }),
    ]));
    expect(html).toContain("신청하기");
    expect(html).not.toContain("자세히");
  });

  it("escapes HTML in user text", () => {
    const html = renderTemplate(base([mk("text", { text: "<script>alert(1)</script>" })]));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes preheader hidden text when provided", () => {
    const html = renderTemplate({ ...base([mk("text", { text: "x" })]), preheader: "미리보기 문구" });
    expect(html).toContain("미리보기 문구");
    expect(html).toContain("display:none");
  });

  it("footer: unsubscribe placeholder + dynamic year + no rgba", () => {
    const html = renderTemplate(base([mk("text", { text: "x" })]));
    expect(html).toContain("수신거부");
    expect(html).toContain(UNSUB_PLACEHOLDER);
    expect(html).toContain(`&copy; ${new Date().getFullYear()}`);
    expect(html).not.toMatch(/rgba\(/);
  });

  it("footer toggles: social + unsubscribe", () => {
    const off = renderTemplate({ ...base([mk("text", { text: "x" })]), footer: { showSocial: false, showUnsubscribe: false } });
    expect(off).not.toContain("youtube.com/@rlwrld.dexterity");
    expect(off).not.toContain(UNSUB_PLACEHOLDER);
  });
});

describe("sanitizeInline (partial formatting)", () => {
  it("keeps bold, drops script, keeps brand color, drops non-brand color", () => {
    const out = sanitizeInline(`<b>강조</b><script>alert(1)</script><span style="color:${TEAL}">teal</span><span style="color:#ff0000">빨강</span>`);
    expect(out).toContain("<strong>강조</strong>");
    expect(out).not.toContain("<script");
    expect(out).toContain(`color:${TEAL}`);
    expect(out).not.toContain("#ff0000");
    expect(out).toContain("빨강"); // 텍스트는 유지, 비브랜드 색만 무시
  });
  it("escapes raw text content", () => {
    expect(sanitizeInline("a < b & c")).toContain("&lt; b &amp;");
  });
  it("renderTemplate uses sanitized html for text blocks", () => {
    const html = renderTemplate(base([mk("text", { html: '<b>굵게</b> 일반' })]));
    expect(html).toContain("<strong>굵게</strong>");
  });
});

describe("migrateSpec (legacy -> flat)", () => {
  it("flattens a legacy container tree", () => {
    const legacy: any = {
      subject: "s", showLogo: true, showFooter: false,
      blocks: [{ id: "c1", type: "container", variant: "hero", children: [
        { id: "h1", type: "heading", text: "T" },
        { id: "b1", type: "button", label: "L", url: "https://x" },
      ] }],
    };
    const mig = migrateSpec(legacy);
    expect(mig.blocks.map((b) => b.type)).toEqual(["heading", "button"]);
    const html = renderTemplate(mig);
    expect(html).toContain("T");
    expect(html).toContain("https://x");
  });

  it("converts very-old flat hero block", () => {
    const legacy: any = {
      subject: "s", showLogo: false, showFooter: false,
      blocks: [{ type: "hero", kicker: "K", title: "T", body: "B", dateBadge: { line1: "D1" }, cta: { label: "L", url: "https://x" } }],
    };
    const html = renderTemplate(migrateSpec(legacy));
    expect(html).toContain("T");
    expect(html).toContain("B");
    expect(html).toContain("L");
    expect(html).toContain("https://x");
    expect(html).toContain("K");
    expect(html).toContain("D1");
  });

  it("is idempotent on already-flat specs", () => {
    const spec: any = { subject: "s", showLogo: false, showFooter: false, blocks: [mk("heading", { text: "T" }), mk("text", { text: "p" })] };
    const once = migrateSpec(spec);
    const twice = migrateSpec(once);
    expect(renderTemplate(once)).toBe(renderTemplate(twice));
  });
});

describe("personalization placeholders", () => {
  it("fills {{name}}/{{email}} with escaped values", () => {
    expect(fillPlaceholders("안녕 {{name}}님 ({{email}})", { name: "<b>", email: "a@b.com" })).toBe("안녕 &lt;b&gt;님 (a@b.com)");
  });
  it("empty name -> blank", () => {
    expect(fillPlaceholders("Hi {{name}}", {})).toBe("Hi ");
  });
  it("replaces unsubscribe placeholder with escaped url", () => {
    const out = fillPlaceholders(`<a href="${UNSUB_PLACEHOLDER}">x</a>`, { unsubscribeUrl: "https://e/u?token=a&b=1" });
    expect(out).toContain("token=a&amp;b=1");
    expect(out).not.toContain(UNSUB_PLACEHOLDER);
  });
  it("previewFill swaps tokens for sample values", () => {
    const out = previewFill("{{name}} / {{email}}");
    expect(out).toContain("홍길동");
    expect(out).toContain(`sample@${brand.auth.senderDomain}`);
  });
  it("usesPersonalization detects tokens", () => {
    expect(usesPersonalization("hi {{name}}")).toBe(true);
    expect(usesPersonalization("plain")).toBe(false);
  });
});
