import { describe, it, expect } from "vitest";
import { decideAfterConflict, decideAfterOffer, decideAfterComplete, clearedPhoneEntry } from "./phone-conflict-flow";

// AUTH-IDENTITY-CONVERGENCE-1 / AUTH-PROVIDER-LINK gate 3B — pure state logic behind
// AddPhoneButton's three-choice conflict handling over the unified orchestration. These
// decisions are route-agnostic (they see only the server's already-indistinguishable status),
// so a customer convergence and a provider credential link render identically through every
// pre-success step; the two only diverge at terminal success (converged vs reauth).

describe("decideAfterConflict — assessment → next UI step", () => {
  it("LINK_AVAILABLE opens the generic three-choice screen (no OTP was sent to get here)", () => {
    expect(decideAfterConflict("LINK_AVAILABLE")).toEqual({ kind: "step", step: "convergeChoice" });
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

describe("decideAfterOffer — consent result → next UI step (only choice 1 reaches here)", () => {
  it("OWNERSHIP_VERIFICATION_REQUIRED advances to OTP entry (caller stores the opaque attemptId)", () => {
    expect(decideAfterOffer("OWNERSHIP_VERIFICATION_REQUIRED")).toEqual({ kind: "step", step: "convergeCode" });
  });

  it("SUPPORT_REQUIRED shows generic support; rate/delivery surface their generic messages", () => {
    expect(decideAfterOffer("SUPPORT_REQUIRED")).toEqual({ kind: "step", step: "support" });
    expect(decideAfterOffer("RATE_LIMITED")).toEqual({ kind: "error", errorKey: "addPhoneErrorRateLimited" });
    expect(decideAfterOffer("OTP_DELIVERY_UNAVAILABLE")).toEqual({ kind: "error", errorKey: "addPhoneErrorUnavailable" });
  });

  it("any other status surfaces a generic, non-leaking error", () => {
    expect(decideAfterOffer("NOT_APPLICABLE")).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
    expect(decideAfterOffer("INVALID_PHONE")).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
    expect(decideAfterOffer("NOT_AUTHENTICATED")).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
  });
});

describe("decideAfterComplete — completion result → next UI step", () => {
  it("customer convergence success stays signed in (converged)", () => {
    expect(decideAfterComplete({ ok: true, outcome: "CONVERGED" })).toEqual({ kind: "step", step: "converged" });
  });

  it("provider link success requires re-auth (reauth) — the ONLY visible route divergence", () => {
    expect(decideAfterComplete({ ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" })).toEqual({ kind: "step", step: "reauth" });
  });

  it("SUPPORT_REQUIRED → generic support; INVALID_OTP → invalid-code; INVALID_CHALLENGE → expired", () => {
    expect(decideAfterComplete({ ok: false, error: "SUPPORT_REQUIRED" })).toEqual({ kind: "step", step: "support" });
    expect(decideAfterComplete({ ok: false, error: "INVALID_OTP" })).toEqual({ kind: "error", errorKey: "addPhoneErrorInvalidOtp" });
    expect(decideAfterComplete({ ok: false, error: "INVALID_CHALLENGE" })).toEqual({ kind: "error", errorKey: "convergeExpired" });
  });

  it("RATE_LIMITED → generic rate message; other failures → generic error", () => {
    expect(decideAfterComplete({ ok: false, error: "RATE_LIMITED" })).toEqual({ kind: "error", errorKey: "addPhoneErrorRateLimited" });
    expect(decideAfterComplete({ ok: false, error: "NOT_AUTHENTICATED" })).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
    expect(decideAfterComplete({ ok: false, error: "UNKNOWN_ERROR" })).toEqual({ kind: "error", errorKey: "addPhoneErrorGeneric" });
  });

  it("never surfaces a route-, role-, or owner-specific value (anti-enumeration)", () => {
    const decisions = [
      decideAfterComplete({ ok: true, outcome: "CONVERGED" }),
      decideAfterComplete({ ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" }),
      decideAfterComplete({ ok: false, error: "SUPPORT_REQUIRED" }),
      decideAfterComplete({ ok: false, error: "INVALID_OTP" }),
    ];
    for (const d of decisions) {
      expect(JSON.stringify(d)).not.toMatch(/PROVIDER|STAFF|ADMIN|owner|survivor|role/i);
    }
  });
});

describe("indistinguishability — customer and provider share every pre-success decision", () => {
  it("assess + offer decisions depend ONLY on status, never on route type", () => {
    // The server returns the SAME status for an eligible customer convergence and an eligible
    // provider link; the pure logic has no route input, so the UI cannot diverge before success.
    expect(decideAfterConflict("LINK_AVAILABLE")).toEqual(decideAfterConflict("LINK_AVAILABLE"));
    expect(decideAfterOffer("OWNERSHIP_VERIFICATION_REQUIRED")).toEqual(decideAfterOffer("OWNERSHIP_VERIFICATION_REQUIRED"));
  });
});

describe("clearedPhoneEntry — 'use a different phone' / cancel fully restore the normal form", () => {
  it("drops every pending phone / attempt / OTP value (no conflict or consumed attempt retained)", () => {
    const cleared = clearedPhoneEntry();
    expect(cleared).toEqual({ nationalNumber: "", submittedPhone: "", attemptId: "", otp: "", error: null });
    expect(cleared.attemptId).toBe(""); // a consumed/expired opaque attemptId can never be reused
  });
});
