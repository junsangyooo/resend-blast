import { describe, it, expect } from "vitest";
import {
  fillPlaceholders, fillSubject, usesPersonalization, hasBlankNameRisk,
  UNSUB_PLACEHOLDER,
} from "./personalize";

describe("fillPlaceholders", () => {
  it("escapes substituted values (HTML context)", () => {
    expect(fillPlaceholders("안녕 {{name}}님 ({{email}})", { name: "<b>", email: "a@b.com" }))
      .toBe("안녕 &lt;b&gt;님 (a@b.com)");
  });

  it("missing name becomes empty string", () => {
    expect(fillPlaceholders("Hi {{name}}", {})).toBe("Hi ");
  });

  it("substitutes unsubscribe placeholder", () => {
    const out = fillPlaceholders(`<a href="${UNSUB_PLACEHOLDER}">x</a>`, { unsubscribeUrl: "https://e/u?token=a&b=1" });
    expect(out).toContain("https://e/u?token=a&amp;b=1");
  });

  it("supports {{firstName}} — first token of name", () => {
    expect(fillPlaceholders("Dear {{firstName}},", { name: "Jane Doe" })).toBe("Dear Jane,");
    expect(fillPlaceholders("Dear {{firstname}},", { name: "Jane Doe" })).toBe("Dear Jane,");
    expect(fillPlaceholders("Dear {{first_name}},", { name: "Jane Doe" })).toBe("Dear Jane,");
  });

  it("supports pipe fallback when value missing", () => {
    expect(fillPlaceholders("Dear {{name|Roboticist}},", {})).toBe("Dear Roboticist,");
    expect(fillPlaceholders("Dear {{firstName|친구}},", {})).toBe("Dear 친구,");
    expect(fillPlaceholders("Dear {{name|Roboticist}},", { name: "Jane" })).toBe("Dear Jane,");
  });

  it("tolerates whitespace inside braces", () => {
    expect(fillPlaceholders("Hi {{ name }}", { name: "Kim" })).toBe("Hi Kim");
  });

  it("leaves unknown tokens untouched", () => {
    expect(fillPlaceholders("{{company}}", { name: "Kim" })).toBe("{{company}}");
  });
});

describe("fillSubject", () => {
  it("substitutes without HTML escaping", () => {
    expect(fillSubject("{{name}}님 초대", { name: "A & B" })).toBe("A & B님 초대");
  });

  it("supports firstName + fallback in subjects", () => {
    expect(fillSubject("{{firstName|친구}}님!", {})).toBe("친구님!");
  });
});

describe("usesPersonalization", () => {
  it("detects all token kinds", () => {
    expect(usesPersonalization("hi {{name}}")).toBe(true);
    expect(usesPersonalization("hi {{firstName}}")).toBe(true);
    expect(usesPersonalization("hi {{email}}")).toBe(true);
    expect(usesPersonalization("hi {{name|f}}")).toBe(true);
    expect(usesPersonalization("plain")).toBe(false);
  });

  it("is stateful-regex safe (consecutive calls)", () => {
    expect(usesPersonalization("hi {{name}}")).toBe(true);
    expect(usesPersonalization("hi {{name}}")).toBe(true);
  });
});

describe("hasBlankNameRisk", () => {
  it("true for name tokens without fallback", () => {
    expect(hasBlankNameRisk("Dear {{name}},")).toBe(true);
    expect(hasBlankNameRisk("Dear {{firstName}},")).toBe(true);
  });

  it("false when fallback provided or only email used", () => {
    expect(hasBlankNameRisk("Dear {{name|Roboticist}},")).toBe(false);
    expect(hasBlankNameRisk("Your address: {{email}}")).toBe(false);
    expect(hasBlankNameRisk("plain")).toBe(false);
  });
});
