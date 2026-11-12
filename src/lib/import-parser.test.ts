import { describe, it, expect } from "vitest";
import { buildFromGrid } from "./import-parser";

describe("buildFromGrid — 고정 헤더 + 정해진 동의어만 인식", () => {
  it("email + name 인식", () => {
    const r = buildFromGrid([
      ["email", "name"],
      ["a@b.com", "Jane Doe"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "a@b.com", name: "Jane Doe" }]);
    expect(r.fields).toEqual({ email: true, name: true, company: false, title: false });
  });

  it("대소문자 무관 (Email/Name)", () => {
    const r = buildFromGrid([
      ["Email", "Name"],
      ["a@b.com", "Jane"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "a@b.com", name: "Jane" }]);
  });

  it("company/title 도 인식해 Recipient 에 부착", () => {
    const r = buildFromGrid([
      ["email", "name", "company", "title"],
      ["a@b.com", "Jane", "Acme", "Director"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "a@b.com", name: "Jane", company: "Acme", title: "Director" }]);
    expect(r.fields).toEqual({ email: true, name: true, company: true, title: true });
  });

  it("정해진 동의어·한글 헤더를 인식한다 (붙여넣기와 같은 기준)", () => {
    const r = buildFromGrid([
      ["\uFEFF이메일", "성함", "소속", "직책"],
      ["a@b.com", "제인", "Acme", "Director"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "a@b.com", name: "제인", company: "Acme", title: "Director" }]);
  });

  it("목록에 없는 헤더는 추측하지 않는다", () => {
    const r = buildFromGrid([
      ["연락처", "누구"],
      ["a@b.com", "Jane"],
    ]);
    expect(r.ok).toBe(false);
  });

  it("email 열이 없으면 에러", () => {
    const r = buildFromGrid([
      ["name", "company"],
      ["Jane", "Acme"],
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("email");
  });

  it("name 열이 없으면 email 만으로 진행 (fields.name=false)", () => {
    const r = buildFromGrid([
      ["email"],
      ["a@b.com"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "a@b.com" }]);
    expect(r.fields.name).toBe(false);
  });

  it("이메일이 비었거나 형식 오류인 행은 건너뛰고 skipped 로 집계", () => {
    const r = buildFromGrid([
      ["email", "name"],
      ["not-an-email", "X"],
      ["", "Y"],
      ["ok@a.com", "Z"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "ok@a.com", name: "Z" }]);
    expect(r.skipped).toBe(2);
  });

  it("완전히 빈 행은 skipped 집계 없이 건너뜀", () => {
    const r = buildFromGrid([
      ["email", "name"],
      ["", ""],
      ["ok@a.com", "Z"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toHaveLength(1);
    expect(r.skipped).toBe(0);
  });

  it("빈 그리드는 에러", () => {
    const r = buildFromGrid([]);
    expect(r.ok).toBe(false);
  });

  it("otherSheetNames 인자를 결과에 그대로 전달", () => {
    const r = buildFromGrid([
      ["email"],
      ["a@b.com"],
    ], ["Sheet2", "Sheet3"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.otherSheetNames).toEqual(["Sheet2", "Sheet3"]);
  });

  it("인식되지 않는 다른 헤더는 무시", () => {
    const r = buildFromGrid([
      ["email", "부서", "name"],
      ["a@b.com", "개발팀", "Jane"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.recipients).toEqual([{ email: "a@b.com", name: "Jane" }]);
  });
});

import { decodeCsv } from "./import-parser";
describe("decodeCsv", () => {
  it("reads UTF-8 and falls back to CP949", () => {
    expect(decodeCsv(new TextEncoder().encode("이메일,이름").buffer as ArrayBuffer)).toBe("이메일,이름");
    // "이름" in CP949/EUC-KR
    const cp949 = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7]);
    expect(decodeCsv(cp949.buffer)).toBe("이름");
  });
});
