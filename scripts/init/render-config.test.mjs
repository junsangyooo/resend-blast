import { describe, it, expect } from "vitest";
import { replaceConst, renderConfig } from "./render-config.mjs";

const TPL = [
  'const SENDER_NAME = "Email Blast";',
  'const AUTH_MODE = "password";',
  'const OPERATOR_EMAIL = "you@example.com";',
  'const OPERATOR_NAME = "Operator";',
  'const SENDER_DOMAIN = "send.example.com";',
  'const APP_ACCENT = "#5b5bf0";',
  'const APP_ACCENT_BRIGHT = "#7c7cff";',
  'const APP_ACCENT_DEEP = "#4a4ad6";',
  'const EMAIL_PRIMARY = "#5b5bf0";',
].join("\n");

describe("replaceConst", () => {
  it("swaps the string literal of a named const", () => {
    expect(replaceConst('const SENDER_NAME = "Email Blast";', "SENDER_NAME", "Example Co"))
      .toBe('const SENDER_NAME = "Example Co";');
  });
  it("throws when the const is absent", () => {
    expect(() => replaceConst("const X = 1;", "Y", "z")).toThrow();
  });
});

describe("renderConfig", () => {
  it("replaces collected values and theme tokens, leaves email untouched", () => {
    const out = renderConfig(TPL, {
      senderName: "Example Co", mode: "google", operatorEmail: "ops@example.org",
      operatorName: "Example Co", senderDomain: "send.example.org",
      appAccent: "#2563eb", appAccentBright: "#3b82f6", appAccentDeep: "#1d4ed8",
    });
    expect(out).toContain('const SENDER_NAME = "Example Co";');
    expect(out).toContain('const AUTH_MODE = "google";');
    expect(out).toContain('const SENDER_DOMAIN = "send.example.org";');
    expect(out).toContain('const APP_ACCENT = "#2563eb";');
    expect(out).toContain('const APP_ACCENT_DEEP = "#1d4ed8";');
    expect(out).toContain('const EMAIL_PRIMARY = "#5b5bf0";'); // unchanged
  });
});
