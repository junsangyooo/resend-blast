import { describe, it, expect, beforeAll } from "vitest";
import { createSession, verifySession } from "./session";

beforeAll(() => { process.env.AUTH_SESSION_SECRET = "test-secret-123"; });

describe("session JWT", () => {
  it("round-trips a valid session", async () => {
    const token = await createSession("kim@rlwrld.ai");
    const payload = await verifySession(token);
    expect(payload?.email).toBe("kim@rlwrld.ai");
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a tampered token", async () => {
    const token = await createSession("kim@rlwrld.ai");
    const tampered = token.slice(0, -3) + "AAA";
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSession("kim@rlwrld.ai");
    process.env.AUTH_SESSION_SECRET = "different-secret";
    const result = await verifySession(token);
    process.env.AUTH_SESSION_SECRET = "test-secret-123";
    expect(result).toBeNull();
  });

  it("rejects malformed / empty tokens", async () => {
    expect(await verifySession("")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("not.a.jwt.token")).toBeNull();
  });
});
