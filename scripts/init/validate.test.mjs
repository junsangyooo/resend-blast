import { describe, it, expect } from "vitest";
import { isEmail, isDomain, domainOf, suggestSenderDomain, builtinFrom } from "./validate.mjs";

describe("validate", () => {
  it("isEmail", () => {
    expect(isEmail("a@b.com")).toBe(true);
    expect(isEmail("nope")).toBe(false);
    expect(isEmail("a@b")).toBe(false);
  });
  it("isDomain", () => {
    expect(isDomain("acme.com")).toBe(true);
    expect(isDomain("send.acme.co.kr")).toBe(true);
    expect(isDomain("acme")).toBe(false);
  });
  it("domainOf", () => {
    expect(domainOf("you@acme.com")).toBe("acme.com");
    expect(domainOf("garbage")).toBe("");
  });
  it("suggestSenderDomain", () => {
    expect(suggestSenderDomain("you@acme.com")).toBe("send.acme.com");
    expect(suggestSenderDomain("garbage")).toBe("");
  });
  it("builtinFrom", () => {
    expect(builtinFrom("Acme", "send.acme.com")).toBe("Acme <hello@send.acme.com>");
  });
});
