import { describe, it, expect } from "vitest";
import { renderEnv } from "./render-env.mjs";

describe("renderEnv", () => {
  it("password mode writes ACCESS_PASSWORD + session secret, no google keys", () => {
    const out = renderEnv({ mode: "password", accessPassword: "1234" }, "SECRET");
    expect(out).toContain("ACCESS_PASSWORD=1234");
    expect(out).toContain("AUTH_SESSION_SECRET=SECRET");
    expect(out).not.toContain("GOOGLE_CLIENT_ID");
  });
  it("google mode writes google keys when present", () => {
    const out = renderEnv({ mode: "google", googleClientId: "cid", googleClientSecret: "csec" }, "S");
    expect(out).toContain("GOOGLE_CLIENT_ID=cid");
    expect(out).toContain("GOOGLE_CLIENT_SECRET=csec");
    expect(out).not.toContain("ACCESS_PASSWORD");
  });
  it("omits optional secrets left blank, includes resend key when given", () => {
    const out = renderEnv({ mode: "google", resendKey: "re_x" }, "S");
    expect(out).toContain("RESEND_EMAIL_TRACKING_API_KEY=re_x");
    expect(out).not.toContain("GOOGLE_CLIENT_ID");
    expect(out.endsWith("\n")).toBe(true);
  });
});
