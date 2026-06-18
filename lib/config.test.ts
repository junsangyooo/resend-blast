import { describe, it, expect, afterEach } from "vitest";
import { isFromAllowed, resolveReplyTo, isAdmin } from "./config";
import { canManageAsync, isAdminAsync } from "./admins";
import { brand } from "../brand.config";

const D = brand.auth.senderDomain; // 발신 허용 도메인 (brand.config.ts)
const orig = process.env.ADMIN_EMAILS;
afterEach(() => { process.env.ADMIN_EMAILS = orig; });

describe("isFromAllowed", () => {
  it("allows the brand sender domain (bare and angle forms)", () => {
    expect(isFromAllowed(`a@${D}`)).toBe(true);
    expect(isFromAllowed(`Name <a@${D}>`)).toBe(true);
  });
  it("rejects other domains", () => {
    expect(isFromAllowed("a@evil.com")).toBe(false);
    expect(isFromAllowed("Name <a@evil.com>")).toBe(false);
  });
});

describe("resolveReplyTo", () => {
  it("empty -> '' (Reply-To 미부착, 회신은 From 으로)", () => {
    expect(resolveReplyTo("")).toBe("");
    expect(resolveReplyTo(undefined)).toBe("");
  });
  it("keeps a valid reply-to on the brand domain", () => {
    expect(resolveReplyTo(`hello@${D}`)).toBe(`hello@${D}`);
  });
  it("rejects foreign domains -> '' (잘못된 기본값 주입 안 함)", () => {
    expect(resolveReplyTo("x@gmail.com")).toBe("");
  });
});

describe("canManageAsync / isAdmin", () => {
  it("legacy (no owner) is manageable by anyone", async () => {
    expect(await canManageAsync(undefined, "a@rlwrld.ai")).toBe(true);
    expect(await canManageAsync("", "a@rlwrld.ai")).toBe(true);
  });
  it("owner can manage, others cannot", async () => {
    expect(await canManageAsync("a@rlwrld.ai", "a@rlwrld.ai")).toBe(true);
    expect(await canManageAsync("a@rlwrld.ai", "b@rlwrld.ai")).toBe(false);
    expect(await canManageAsync("a@rlwrld.ai", null)).toBe(false);
  });
  it("admins can manage anything (env seed)", async () => {
    process.env.ADMIN_EMAILS = "boss@rlwrld.ai, ops@rlwrld.ai";
    expect(isAdmin("boss@rlwrld.ai")).toBe(true);
    expect(isAdmin("BOSS@rlwrld.ai")).toBe(true);
    expect(isAdmin("rando@rlwrld.ai")).toBe(false);
    expect(await isAdminAsync("ops@rlwrld.ai")).toBe(true);
    expect(await canManageAsync("a@rlwrld.ai", "ops@rlwrld.ai")).toBe(true);
  });
});
