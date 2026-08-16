import { describe, it, expect } from "vitest";
import { isVerificationEditableStatus } from "./verification-lifecycle";

// Gate 1B — the single source of truth for "may the provider edit + (re)submit".
describe("isVerificationEditableStatus", () => {
  it("is TRUE only for DRAFT and CHANGES_REQUESTED", () => {
    expect(isVerificationEditableStatus("DRAFT")).toBe(true);
    expect(isVerificationEditableStatus("CHANGES_REQUESTED")).toBe(true);
  });

  it.each(["APPLIED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "DEACTIVATED"])(
    "is FALSE for %s (document mutation + submit are locked)",
    (status) => {
      expect(isVerificationEditableStatus(status)).toBe(false);
    }
  );
});
