import { describe, it, expect } from "vitest";
import { slugify, deriveBaseSlug } from "./lists";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

describe("slugify", () => {
  it("영문/숫자 이름은 정상 슬러그", () => {
    expect(slugify("Hensen VC 2026")).toBe("hensen-vc-2026");
  });
  it("순수 한글은 빈 문자열 (슬러그 불가)", () => {
    expect(slugify("발신자 변환 및 이름 매핑 테스트")).toBe("");
  });
});

describe("deriveBaseSlug — 한글 전용 이름도 항상 유효 슬러그", () => {
  it("영문 섞이면 그대로 slugify", () => {
    expect(deriveBaseSlug("Hensen VC 명단")).toBe("hensen-vc");
  });
  it("순수 한글 이름 → fallback 슬러그 생성 (유효)", () => {
    const s = deriveBaseSlug("발신자 변환 및 이름 매핑 테스트", undefined, "abc123");
    expect(s).toBe("list-abc123");
    expect(SLUG_RE.test(s)).toBe(true);
  });
  it("명시적 slug 입력 우선", () => {
    expect(deriveBaseSlug("아무 이름", "My-Custom Slug")).toBe("my-custom-slug");
  });
  it("seed 없이도 유효한 fallback (SLUG_RE 통과)", () => {
    const s = deriveBaseSlug("순수한글이름");
    expect(SLUG_RE.test(s)).toBe(true);
    expect(s.startsWith("list-")).toBe(true);
  });
});
