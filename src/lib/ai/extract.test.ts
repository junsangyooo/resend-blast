import { describe, it, expect } from "vitest";
import { extractFenced, commentaryBefore } from "./extract";

describe("extractFenced", () => {
  it("extracts last json block", () => {
    const t = 'a\n```json\n{"x":1}\n```\nb\n```json\n{"x":2}\n```';
    expect(extractFenced(t, "json")).toBe('{"x":2}');
  });
  it("accepts bare fence for json", () => {
    expect(extractFenced('```\n{"a":1}\n```', "json")).toBe('{"a":1}');
  });
  it("extracts html block, ignores json", () => {
    expect(extractFenced('```json\n{}\n```\n```html\n<p>x</p>\n```', "html")).toBe("<p>x</p>");
  });
  it("null when missing", () => { expect(extractFenced("no code", "json")).toBeNull(); });
});
describe("commentaryBefore", () => {
  it("returns text before first fence", () => {
    expect(commentaryBefore("코멘트입니다\n```json\n{}\n```")).toBe("코멘트입니다");
  });
  it("returns whole text without fence", () => { expect(commentaryBefore(" x ")).toBe("x"); });
});
