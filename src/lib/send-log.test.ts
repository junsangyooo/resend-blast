import { describe, it, expect } from "vitest";
import { shouldApplyLiveStatus } from "./send-log";

describe("shouldApplyLiveStatus — 웹훅 순서 역전 방지", () => {
  it("더 진전된 상태로는 올라간다", () => {
    expect(shouldApplyLiveStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyLiveStatus("delivered", "opened")).toBe(true);
    expect(shouldApplyLiveStatus("opened", "clicked")).toBe(true);
  });
  it("이전 상태로는 내려가지 않는다 (늦게 도착한 웹훅 무시)", () => {
    expect(shouldApplyLiveStatus("opened", "delivered")).toBe(false);
    expect(shouldApplyLiveStatus("clicked", "opened")).toBe(false);
    expect(shouldApplyLiveStatus("delivered", "sent")).toBe(false);
  });
  it("bounced/complained 는 종단 — 이후 어떤 상태로도 안 덮인다", () => {
    expect(shouldApplyLiveStatus("bounced", "delivered")).toBe(false);
    expect(shouldApplyLiveStatus("bounced", "opened")).toBe(false);
    expect(shouldApplyLiveStatus("complained", "clicked")).toBe(false);
  });
  it("현재 상태가 없으면 항상 적용", () => {
    expect(shouldApplyLiveStatus(undefined, "delivered")).toBe(true);
    expect(shouldApplyLiveStatus("", "sent")).toBe(true);
  });
  it("동순위는 허용 (타임스탬프 갱신)", () => {
    expect(shouldApplyLiveStatus("delivered", "delivered")).toBe(true);
  });
});
