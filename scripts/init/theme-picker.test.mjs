import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const html = await readFile(
  fileURLToPath(new URL("./theme-picker.html", import.meta.url)), "utf8"
);

describe("theme-picker.html", () => {
  it("has the injection placeholder", () => {
    expect(html).toContain("/*__INIT_INJECT__*/");
  });
  it("reads injected themes/token, not a hardcoded list", () => {
    expect(html).toContain("window.__THEMES");
    expect(html).toContain("window.__TOKEN");
  });
  it("posts selection with token to /select", () => {
    expect(html).toMatch(/fetch\(\s*["']\/select["']/);
    expect(html).toMatch(/token:\s*window\.__TOKEN/);
  });
});
