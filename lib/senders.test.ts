import { describe, it, expect } from "vitest";
import { addressOf, displayNameFromEmail, myAccountOption } from "./senders";

describe("addressOf", () => {
  it("extracts from angle form", () => {
    expect(addressOf("Jacey Cho <jacey.cho@rlwrld.ai>")).toBe("jacey.cho@rlwrld.ai");
    expect(addressOf("X <A@B.COM>")).toBe("a@b.com");
  });
  it("accepts bare address", () => {
    expect(addressOf("launch@rlwrld.ai")).toBe("launch@rlwrld.ai");
  });
  it("null for garbage", () => {
    expect(addressOf("not an email")).toBeNull();
    expect(addressOf("")).toBeNull();
  });
});

describe("displayNameFromEmail", () => {
  it("title-cases local part tokens", () => {
    expect(displayNameFromEmail("junsang.yoo@rlwrld.ai")).toBe("Junsang Yoo");
    expect(displayNameFromEmail("jane_doe@rlwrld.ai")).toBe("Jane Doe");
    expect(displayNameFromEmail("launch@rlwrld.ai")).toBe("Launch");
  });
});

describe("myAccountOption", () => {
  it("builds a personal virtual option for the viewer", () => {
    const o = myAccountOption("Junsang.Yoo@rlwrld.ai");
    expect(o.value).toBe("Junsang Yoo <junsang.yoo@rlwrld.ai>");
    expect(o.scope).toBe("personal");
    expect(o.owner).toBe("junsang.yoo@rlwrld.ai");
  });
});
