import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const tpl = await readFile(
  fileURLToPath(new URL("./brand.config.template.ts", import.meta.url)), "utf8"
);

const INIT_CONSTS = [
  "COMPANY","LEGAL_NAME","LOGIN_DOMAIN","SENDER_DOMAIN","AUTH_MODE",
  "OPERATOR_EMAIL","OPERATOR_NAME","REPLY_TO_DEFAULT","POSTAL_ADDRESS_DEFAULT",
  "CONTACT_EMAIL_DEFAULT","APP_ACCENT","APP_ACCENT_BRIGHT","APP_ACCENT_DEEP",
  "EMAIL_PRIMARY","EMAIL_PRIMARY_CTA","EMAIL_TINT_BG","EMAIL_TINT_BORDER",
];

describe("brand.config.template", () => {
  it("declares every @init const as a string literal", () => {
    for (const name of INIT_CONSTS) {
      expect(tpl).toMatch(new RegExp(`const\\s+${name}\\s*=\\s*"[^"]*"`));
    }
  });
  it("wires app accent tokens to APP_* (decoupled from email)", () => {
    expect(tpl).toMatch(/appAccent:\s*APP_ACCENT\b/);
    expect(tpl).toMatch(/appAccentDeep:\s*APP_ACCENT_DEEP\b/);
    expect(tpl).toMatch(/appAccentBright:\s*APP_ACCENT_BRIGHT\b/);
  });
  it("wires email colors to EMAIL_* (not APP_*)", () => {
    expect(tpl).toMatch(/teal:\s*EMAIL_PRIMARY\b/);
    expect(tpl).toMatch(/mint:\s*EMAIL_PRIMARY_CTA\b/);
  });
  it("auth.mode references AUTH_MODE const", () => {
    expect(tpl).toMatch(/mode:\s*AUTH_MODE\s+as/);
  });
});
