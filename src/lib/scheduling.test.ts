import { describe, it, expect } from "vitest";
import { kstInputToDate, toKstParts, formatKst } from "./kst";
import { ensureUnsubFooter, hasUnsubLink } from "./unsub-footer";
import { classifyPrior, type PriorRecord } from "./prior";
import { dueAction, validateScheduleTime, remainingAllowance } from "./schedule-rules";

describe("kst", () => {
  it("converts KST wall clock to the right UTC instant", () => {
    expect(kstInputToDate("2026-11-12", "09:30")!.toISOString()).toBe("2026-11-12T00:30:00.000Z");
    expect(kstInputToDate("2026-01-01", "00:10")!.toISOString()).toBe("2025-12-31T15:10:00.000Z");
  });
  it("is independent of US daylight saving dates", () => {
    // Around the 2026 US DST switch (Mar 8) KST stays UTC+9.
    expect(kstInputToDate("2026-03-08", "18:00")!.toISOString()).toBe("2026-03-08T09:00:00.000Z");
    expect(kstInputToDate("2026-07-01", "18:00")!.toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });
  it("rejects invalid input", () => {
    expect(kstInputToDate("2026-02-31", "09:00")).toBeNull();
    expect(kstInputToDate("2026-11-12", "24:00")).toBeNull();
    expect(kstInputToDate("", "09:00")).toBeNull();
  });
  it("round-trips and formats", () => {
    const d = kstInputToDate("2026-11-12", "09:05")!;
    expect(toKstParts(d)).toEqual({ date: "2026-11-12", time: "09:05" });
    expect(formatKst(d)).toBe("11월 12일 (목) 09:05");
  });
});

describe("unsub footer", () => {
  it("appends once before </body> and is idempotent", () => {
    const html = "<html><body><p>hi</p></body></html>";
    const out = ensureUnsubFooter(html);
    expect(hasUnsubLink(out)).toBe(true);
    expect(out.indexOf("data-eb-unsub-footer")).toBeLessThan(out.indexOf("</body>"));
    expect(ensureUnsubFooter(out)).toBe(out);
  });
  it("leaves emails that already have a link untouched", () => {
    const html = '<body><a href="%%UNSUB_URL%%">x</a></body>';
    expect(ensureUnsubFooter(html)).toBe(html);
  });
});

describe("classifyPrior", () => {
  const base: PriorRecord = {
    id: "s1", createdAt: "2026-06-10T00:00:00.000Z", status: "completed", templateName: "t",
    htmlHash: "h1", recipients: [{ email: "a@x.com", status: "sent" }, { email: "b@x.com", status: "failed" }],
  };
  it("flags same content, ignores failed recipients and tests", () => {
    const hits = classifyPrior([base, { ...base, id: "t1", kind: "test" }], {
      templateName: "t", currentHash: "h1", emails: ["A@x.com", "b@x.com", "c@x.com"],
    });
    expect(hits).toEqual([{ email: "a@x.com", kind: "same", sendId: "s1", at: base.createdAt }]);
  });
  it("flags modified content by hash", () => {
    const hits = classifyPrior([base], { templateName: "t", currentHash: "h2", emails: ["a@x.com"] });
    expect(hits[0].kind).toBe("modified");
  });
  it("uses template modified time for legacy records without hash", () => {
    const legacy = { ...base, htmlHash: undefined };
    expect(classifyPrior([legacy], { templateName: "t", currentHash: "h", templateModifiedAt: "2026-06-11T00:00:00.000Z", emails: ["a@x.com"] })[0].kind).toBe("modified");
    expect(classifyPrior([legacy], { templateName: "t", currentHash: "h", templateModifiedAt: "2026-06-01T00:00:00.000Z", emails: ["a@x.com"] })[0].kind).toBe("same");
  });
  it("returns nothing for a new email", () => {
    expect(classifyPrior([base], { templateName: "other", currentHash: "h1", emails: ["a@x.com"] })).toEqual([]);
  });
  it("reports pending scheduled sends and prefers received over scheduled", () => {
    const sch: PriorRecord = { id: "s2", createdAt: "2026-06-12T00:00:00.000Z", status: "scheduled", scheduledAt: "2026-06-20T00:00:00.000Z", templateName: "t", recipients: [{ email: "a@x.com", status: "pending" }, { email: "c@x.com", status: "pending" }] };
    const hits = classifyPrior([base, sch], { templateName: "t", currentHash: "h1", emails: ["a@x.com", "c@x.com"] });
    expect(hits.map((h) => [h.email, h.kind])).toEqual([["a@x.com", "same"], ["c@x.com", "scheduled"]]);
  });
});

describe("schedule rules", () => {
  const boot = 1_000_000;
  it("runs due schedules created while the server is up, marks earlier ones missed", () => {
    expect(dueAction({ status: "scheduled", scheduledAt: new Date(boot + 5000).toISOString() }, boot + 6000, boot)).toBe("run");
    expect(dueAction({ status: "scheduled", scheduledAt: new Date(boot - 5000).toISOString() }, boot + 1000, boot)).toBe("missed");
    expect(dueAction({ status: "scheduled", scheduledAt: new Date(boot + 60000).toISOString() }, boot + 1000, boot)).toBe("none");
    expect(dueAction({ status: "completed", scheduledAt: new Date(boot).toISOString() }, boot + 1000, boot)).toBe("none");
  });
  it("validates lead time", () => {
    const now = Date.now();
    expect(validateScheduleTime(new Date(now + 30_000), now)).not.toBeNull();
    expect(validateScheduleTime(new Date(now + 5 * 60_000), now)).toBeNull();
    expect(validateScheduleTime(new Date(now + 100 * 86400_000), now)).not.toBeNull();
  });
  it("computes remaining allowance", () => {
    expect(remainingAllowance(1900, 100, 2000, 5000)).toBe(100);
    expect(remainingAllowance(0, 4990, 2000, 5000)).toBe(10);
    expect(remainingAllowance(2100, 0, 2000, 5000)).toBe(0);
  });
});

import { parseZonedInstant } from "./schedule-rules";
describe("parseZonedInstant", () => {
  it("accepts only instants with an explicit zone", () => {
    expect(parseZonedInstant("2026-11-12T00:30:00.000Z")!.toISOString()).toBe("2026-11-12T00:30:00.000Z");
    expect(parseZonedInstant("2026-11-12T09:30+09:00")!.toISOString()).toBe("2026-11-12T00:30:00.000Z");
    expect(parseZonedInstant("2026-11-12T09:30")).toBeNull();
    expect(parseZonedInstant("tomorrow")).toBeNull();
    expect(parseZonedInstant(123)).toBeNull();
  });
});
