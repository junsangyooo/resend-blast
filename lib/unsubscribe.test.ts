import { describe, it, expect } from "vitest";
import { makeUnsubToken, verifyUnsubToken } from "./unsubscribe";

describe("unsubscribe token", () => {
  it("round-trips a valid token to its email + sendId", () => {
    const t = makeUnsubToken("User@RLWRLD.ai", "abc123");
    const v = verifyUnsubToken(t);
    expect(v).not.toBeNull();
    expect(v!.email).toBe("user@rlwrld.ai"); // normalized lowercase
    expect(v!.sendId).toBe("abc123");
  });

  it("rejects a tampered signature", () => {
    const t = makeUnsubToken("a@rlwrld.ai", "s1");
    const [body] = t.split(".");
    expect(verifyUnsubToken(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a tampered payload (email swap)", () => {
    const t = makeUnsubToken("a@rlwrld.ai", "s1");
    const sig = t.split(".")[1];
    const forged = Buffer.from(JSON.stringify({ e: "evil@rlwrld.ai", s: "s1", t: 1 }), "utf-8")
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(verifyUnsubToken(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyUnsubToken("")).toBeNull();
    expect(verifyUnsubToken("nodot")).toBeNull();
    expect(verifyUnsubToken(null)).toBeNull();
  });
});
