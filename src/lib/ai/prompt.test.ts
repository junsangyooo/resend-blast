import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildTurnPrompt } from "./prompt";
import { brand } from "../../brand.config";

describe("buildSystemPrompt(spec)", () => {
  const p = buildSystemPrompt("spec");
  it("injects brand values (no hardcode)", () => {
    expect(p).toContain(brand.identity.companyName);
  });
  it("documents all 10 block types and output contract", () => {
    for (const t of ["heading","text","button","badge","kicker","numbered","agenda","grid","image","divider"]) expect(p).toContain(`"${t}"`);
    expect(p).toContain("```json");
  });
  it("documents personalization + inline tags", () => {
    expect(p).toContain("{{name}}");
    expect(p).toContain("<u>");
  });
});
describe("buildTurnPrompt", () => {
  it("serializes history, current spec and images", () => {
    const t = buildTurnPrompt({
      mode: "spec",
      messages: [{ role: "user", content: "만들어줘" }, { role: "assistant", content: "만들었습니다" }, { role: "user", content: "제목 바꿔줘" }],
      current: { subject: "S", showLogo: true, showFooter: true, blocks: [] },
      imageUrls: [{ url: "https://x/y.png", filename: "y.png" }],
    });
    expect(t).toContain("만들어줘");
    expect(t).toContain('"subject": "S"');
    expect(t).toContain("y.png");
    expect(t.trim().endsWith("제목 바꿔줘")).toBe(true);
  });
});
