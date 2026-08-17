import { describe, it, expect } from "vitest";
import { canProviderEditPrimaryActivity, MAX_PROVIDER_SELF_ACTIVITIES } from "./activity-policy";

// Gate B4 — the pure activity-governance policy.

describe("activity policy", () => {
  it("a provider may self-select at most ONE activity", () => {
    expect(MAX_PROVIDER_SELF_ACTIVITIES).toBe(1);
  });

  it("the primary is self-editable ONLY while the application is DRAFT", () => {
    expect(canProviderEditPrimaryActivity("DRAFT")).toBe(true);
    for (const status of ["APPLIED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "SUSPENDED", "DEACTIVATED"]) {
      expect(canProviderEditPrimaryActivity(status)).toBe(false);
    }
  });
});
