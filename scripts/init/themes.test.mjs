import { describe, it, expect } from "vitest";
import { THEMES, getTheme, appTokensFor } from "./themes.mjs";

describe("themes", () => {
  it("has 6 presets with unique ids and required hex fields", () => {
    expect(THEMES).toHaveLength(6);
    const ids = THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(6);
    for (const t of THEMES) {
      for (const k of ["accent", "cta", "deep"]) {
        expect(t[k]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
  it("indigo is the default baseline", () => {
    expect(getTheme("indigo")).toMatchObject({ accent: "#5b5bf0", cta: "#7c7cff", deep: "#4a4ad6" });
  });
  it("appTokensFor maps preset to app accent tokens", () => {
    expect(appTokensFor("ocean")).toEqual({
      APP_ACCENT: "#2563eb", APP_ACCENT_BRIGHT: "#3b82f6", APP_ACCENT_DEEP: "#1d4ed8",
    });
  });
  it("appTokensFor throws on unknown id", () => {
    expect(() => appTokensFor("nope")).toThrow();
  });
});
