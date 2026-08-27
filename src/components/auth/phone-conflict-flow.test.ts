import { describe, it, expect } from "vitest";
import { decideAfterConflict, clearedPhoneEntry } from "./phone-conflict-flow";

// AUTH-IDENTITY-CONVERGENCE-1 (conflict-choice UX) — pure state logic behind
// AddPhoneButton's three-choice conflict handling.

describe("decideAfterConflict — assessment → next UI step", () => {
  it("CONVERGENCE_AVAILABLE opens the three-choice screen (no OTP is sent to get here)", () => {
    expect(decideAfterConflict("CONVERGENCE_AVAILABLE")).toEqual({ kind: "step", step: "convergeChoice" });
  });

  it("SUPPORT_REQUIRED shows the generic support message", () => {
    expect(decideAfterConflict("SUPPORT_REQUIRED")).toEqual({ kind: "step", step: "support" });
  });

  it("INVALID_PHONE surfaces the invalid-phone error key", () => {
    expect(decideAfterConflict("INVALID_PHONE")).toEqual({ kind: "error", errorKey: "addPhoneErrorInvalid" });
  });

  it("any other status surfaces a generic, non-leaking error", () => {
    expect(decideAfterConflict("NOT_AUTHENTICATED")).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
    expect(decideAfterConflict("NOT_APPLICABLE")).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
    expect(decideAfterConflict("UNKNOWN_ERROR")).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
  });
});

describe("clearedPhoneEntry — 'use a different phone' fully restores the normal form", () => {
  it("drops every pending phone / convergence / OTP-proof value (no conflict retained)", () => {
    const cleared = clearedPhoneEntry();
    expect(cleared).toEqual({ nationalNumber: "", submittedPhone: "", otp: "", error: null });
    // Explicitly: nothing carries a previous number, a submitted E.164, an OTP, or an error.
    expect(cleared.nationalNumber).toBe("");
    expect(cleared.submittedPhone).toBe("");
    expect(cleared.otp).toBe("");
    expect(cleared.error).toBeNull();
  });
});
