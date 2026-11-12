import { describe, it, expect } from "vitest";
import { toAiError, looksLikeApiKey, AI_ERROR } from "./auth";

describe("AI auth error mapping", () => {
  it("no key + CLI not logged in → ask to register a key", () => {
    expect(toAiError("cli", "authentication_failed", "").userMessage).toBe(AI_ERROR.noAuth);
    expect(toAiError("cli", undefined, "Not logged in · Please run /login").userMessage).toBe(AI_ERROR.noAuth);
  });
  it("a registered or .env key that fails → check the key", () => {
    expect(toAiError("settings", "authentication_failed", "Invalid API key").userMessage).toBe(AI_ERROR.badKey);
    expect(toAiError("env", undefined, "invalid x-api-key").userMessage).toBe(AI_ERROR.badKey);
  });
  it("billing / rate limit / other", () => {
    expect(toAiError("settings", "billing_error", "").userMessage).toBe(AI_ERROR.billing);
    expect(toAiError("settings", "rate_limit", "").userMessage).toBe(AI_ERROR.rateLimit);
    expect(toAiError("settings", "server_error", "boom").userMessage).toBe(AI_ERROR.generic);
  });
  it("key shape check", () => {
    expect(looksLikeApiKey("sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
    expect(looksLikeApiKey("re_123")).toBe(false);
    expect(looksLikeApiKey("")).toBe(false);
  });
});
