import { describe, it, expect } from "vitest";
import { setBlockField, getBlockField, mergeAiResult, changedBlockIds } from "./spec-edit";
import { emptyHistory, record, undo, redo } from "./studio-history";
import type { TemplateSpec } from "./blocks";

const spec = (): TemplateSpec => ({
  subject: "S", showLogo: true, showFooter: true,
  blocks: [
    { id: "a", type: "heading", text: "Hello" },
    { id: "b", type: "numbered", items: [{ title: "one" }, { title: "two" }] },
    { id: "c", type: "text", html: "body" },
  ],
} as TemplateSpec);

describe("spec-edit", () => {
  it("sets nested fields immutably", () => {
    const s = spec();
    const n = setBlockField(s, "b", "items.1.title", "TWO");
    expect(getBlockField(n.blocks[1], "items.1.title")).toBe("TWO");
    expect(getBlockField(s.blocks[1], "items.1.title")).toBe("two");
    expect(n.blocks[0]).toBe(s.blocks[0]);
  });

  it("merge keeps hand edits on blocks the AI did not change", () => {
    const base = spec();
    const current = setBlockField(base, "a", "text", "Hand edit");           // edited while AI ran
    const ai = setBlockField(base, "c", "html", "AI body");                 // AI changed only c
    const m = mergeAiResult(base, ai, current);
    expect(getBlockField(m.blocks[0], "text")).toBe("Hand edit");
    expect(getBlockField(m.blocks[2], "html")).toBe("AI body");
  });

  it("merge: AI wins on blocks both changed, and follows AI order/removals", () => {
    const base = spec();
    const current = setBlockField(base, "c", "html", "hand");
    const ai: TemplateSpec = { ...setBlockField(base, "c", "html", "ai"), blocks: [] };
    ai.blocks = [setBlockField(base, "c", "html", "ai").blocks[2], base.blocks[0]];
    const m = mergeAiResult(base, ai, current);
    expect(m.blocks.map((b) => b.id)).toEqual(["c", "a"]);
    expect(getBlockField(m.blocks[0], "html")).toBe("ai");
    expect(changedBlockIds(current, m)).toEqual(["c"]);
  });
});

describe("studio-history", () => {
  it("merges consecutive hand edits on the same unit; AI is its own step", () => {
    let h = emptyHistory<string>();
    h = record(h, { kind: "hand", unit: "a", before: "0", after: "1" });
    h = record(h, { kind: "hand", unit: "a", before: "1", after: "2" });
    h = record(h, { kind: "ai", unit: "ai", before: "2", after: "3" });
    h = record(h, { kind: "hand", unit: "b", before: "3", after: "4" });
    expect(h.past.length).toBe(3);
    let r = undo(h)!; expect(r.state).toBe("3");
    r = undo(r.history)!; expect(r.state).toBe("2");   // AI undone, hand edits kept
    r = undo(r.history)!; expect(r.state).toBe("0");
    const rr = redo(r.history)!; expect(rr.state).toBe("2");
  });

  it("undoing AI keeps hand edits made while the AI was running", () => {
    // hand edit during the run is recorded first; AI result's 'before' is the state at apply time
    let h = emptyHistory<string>();
    h = record(h, { kind: "hand", unit: "a", before: "base", after: "base+hand" });
    h = record(h, { kind: "ai", unit: "ai", before: "base+hand", after: "ai(base)+hand" });
    expect(undo(h)!.state).toBe("base+hand");
  });
});

describe("merge: deletions during the AI run", () => {
  it("a block deleted by hand stays deleted when the AI did not touch it", () => {
    const base = spec();
    const current = { ...base, blocks: base.blocks.filter((b) => b.id !== "a") };
    const ai = setBlockField(base, "c", "html", "AI");
    const m = mergeAiResult(base, ai, current);
    expect(m.blocks.map((b) => b.id)).toEqual(["b", "c"]);
  });
});
