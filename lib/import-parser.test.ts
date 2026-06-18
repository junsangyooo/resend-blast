import { describe, it, expect } from "vitest";
import { analyzeGrid, buildRecipients, type ColumnRole } from "./import-parser";

const meta = { sheetNames: ["Sheet1"], sheetName: "Sheet1", fileName: "test.csv" };

describe("analyzeGrid header detection", () => {
  it("recognizes 'Email, Full Name' synonyms (이름 유실 버그 회귀)", () => {
    const a = analyzeGrid([
      ["Email", "Full Name"],
      ["a@b.com", "Jane Doe"],
    ], meta);
    expect(a.hasHeader).toBe(true);
    expect(a.roles).toEqual(["email", "name"]);
    const r = buildRecipients(a);
    expect(r.rows).toEqual([{ email: "a@b.com", name: "Jane Doe" }]);
  });

  it("recognizes 'First Name, Last Name, Email' (임포트 전멸 버그 회귀)", () => {
    const a = analyzeGrid([
      ["First Name", "Last Name", "Email"],
      ["Jane", "Doe", "a@b.com"],
      ["민준", "김", "b@c.com"],
    ], meta);
    expect(a.hasHeader).toBe(true);
    expect(a.roles).toEqual(["first", "last", "email"]);
    const r = buildRecipients(a);
    expect(r.rows).toEqual([
      { email: "a@b.com", name: "Jane Doe" },
      { email: "b@c.com", name: "김민준" }, // 한글은 성+이름 공백 없이
    ]);
  });

  it("name 컬럼과 last 컬럼 공존 시 성을 합성한다 (헤더 [성, 이름])", () => {
    const a = analyzeGrid([
      ["성", "이름", "Email"],
      ["홍", "길동", "h@r.ai"],
    ], meta);
    expect(a.roles).toEqual(["last", "name", "email"]);
    expect(buildRecipients(a).rows).toEqual([{ email: "h@r.ai", name: "홍길동" }]);
  });

  it("recognizes Korean 성명/이메일주소 headers", () => {
    const a = analyzeGrid([
      ["성명", "이메일주소"],
      ["홍길동", "h@r.ai"],
    ], meta);
    expect(a.roles).toEqual(["name", "email"]);
  });

  it("detects header even with unknown words when first row has no email", () => {
    const a = analyzeGrid([
      ["참가자", "연락처이메일"],
      ["홍길동", "h@r.ai"],
    ], meta);
    expect(a.hasHeader).toBe(true);
    // 이메일 컬럼은 내용 기반 추론, 2열이라 나머지는 이름
    expect(a.roles[1]).toBe("email");
    expect(a.roles[0]).toBe("name");
  });

  it("headerless 2-col: email col by content, other col is name", () => {
    const a = analyzeGrid([
      ["hong@a.com", "홍길동"],
      ["kim@a.com", "김민준"],
    ], meta);
    expect(a.hasHeader).toBe(false);
    expect(a.roles).toEqual(["email", "name"]);
  });

  it("headerless 1-col emails", () => {
    const a = analyzeGrid([["a@b.com"], ["c@d.com"]], meta);
    expect(a.roles).toEqual(["email"]);
    expect(buildRecipients(a).rows).toHaveLength(2);
  });
});

describe("buildRecipients with role overrides", () => {
  it("First만 사용: last 컬럼을 ignore 로 바꾸면 first 만 이름이 된다", () => {
    const a = analyzeGrid([
      ["First Name", "Last Name", "Email"],
      ["Jane", "Doe", "a@b.com"],
    ], meta);
    const roles: ColumnRole[] = ["first", "ignore", "email"];
    const r = buildRecipients(a, roles);
    expect(r.rows).toEqual([{ email: "a@b.com", name: "Jane" }]);
  });

  it("reports invalid emails as errors", () => {
    const a = analyzeGrid([
      ["Email", "Name"],
      ["not-an-email", "X"],
      ["ok@a.com", "Y"],
    ], meta);
    const r = buildRecipients(a);
    expect(r.rows).toEqual([{ email: "ok@a.com", name: "Y" }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toBe("이메일 형식 오류");
  });
});
