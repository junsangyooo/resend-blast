import { describe, it, expect } from "vitest";
import { contentHash, globalThrottle } from "./send-guards";

describe("contentHash", () => {
  const base = { sentBy: "me@example.com", from: "launch@example.com", templateName: "t", subject: "s" };

  it("is stable regardless of recipient order / case", () => {
    const a = contentHash({ ...base, emails: ["A@x.com", "b@y.com"] });
    const b = contentHash({ ...base, emails: ["b@Y.com", "a@x.com"] });
    expect(a).toBe(b);
  });

  it("changes when subject changes", () => {
    const a = contentHash({ ...base, emails: ["a@x.com"] });
    const b = contentHash({ ...base, subject: "다른 제목", emails: ["a@x.com"] });
    expect(a).not.toBe(b);
  });

  it("changes when recipient set changes", () => {
    const a = contentHash({ ...base, emails: ["a@x.com"] });
    const b = contentHash({ ...base, emails: ["a@x.com", "c@z.com"] });
    expect(a).not.toBe(b);
  });
});

describe("globalThrottle", () => {
  it("spaces consecutive calls by at least the gap", async () => {
    const gap = 60;
    const start = Date.now();
    await globalThrottle(gap); // first slot is usually immediate
    await globalThrottle(gap); // second one comes after gap
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(gap - 15); // allow timer jitter
  });
});
