import { describe, it, expect } from "vitest";
import { addressOf, displayNameFromEmail, myAccountOption } from "./senders";

describe("addressOf", () => {
  it("extracts from angle form", () => {
    expect(addressOf("John Smith <john.smith@example.com>")).toBe("john.smith@example.com");
    expect(addressOf("X <A@B.COM>")).toBe("a@b.com");
  });
  it("accepts bare address", () => {
    expect(addressOf("launch@example.com")).toBe("launch@example.com");
  });
  it("null for garbage", () => {
    expect(addressOf("not an email")).toBeNull();
    expect(addressOf("")).toBeNull();
  });
});

describe("displayNameFromEmail", () => {
  it("title-cases local part tokens", () => {
    expect(displayNameFromEmail("jane.doe@example.com")).toBe("Jane Doe");
    expect(displayNameFromEmail("jane_doe@example.com")).toBe("Jane Doe");
    expect(displayNameFromEmail("launch@example.com")).toBe("Launch");
  });
});

describe("myAccountOption", () => {
  it("builds a personal virtual option for the viewer", () => {
    const o = myAccountOption("Jane.Doe@example.com");
    expect(o.value).toBe("Jane Doe <jane.doe@example.com>");
    expect(o.scope).toBe("personal");
    expect(o.owner).toBe("jane.doe@example.com");
  });
});
