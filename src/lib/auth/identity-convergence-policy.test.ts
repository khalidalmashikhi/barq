import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./linked-email", () => ({
  isSyntheticAuthEmail: (e: string | null | undefined) => typeof e === "string" && e.toLowerCase().endsWith("@phone.barq.internal"),
}));

const { assessEligibility, hasRealVerifiedEmail } = await import("./identity-convergence-policy");
type IdentitySide = import("./identity-convergence-policy").IdentitySide;

// AUTH-IDENTITY-CONVERGENCE-1 — pure policy: survivor determination + eligibility.

function side(over: Partial<IdentitySide>): IdentitySide {
  return {
    userId: "u-x",
    authUserId: "a-x",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    userPhone: null,
    authEmail: null,
    authEmailVerified: false,
    authPhone: null,
    authPhoneVerified: false,
    hasPrivilege: false,
    hasCustomer: true,
    customerId: "c-x",
    hasMeaningfulHistory: false,
    ...over,
  };
}

const emailSide = side({ userId: "B", authUserId: "aB", authEmail: "e@x.com", authEmailVerified: true });
const phoneSide = side({ userId: "A", authUserId: "aA", authPhone: "+96891112222", authPhoneVerified: true });

describe("hasRealVerifiedEmail", () => {
  it("true only for verified, non-synthetic email", () => {
    expect(hasRealVerifiedEmail(side({ authEmail: "e@x.com", authEmailVerified: true }))).toBe(true);
    expect(hasRealVerifiedEmail(side({ authEmail: "e@x.com", authEmailVerified: false }))).toBe(false);
    expect(hasRealVerifiedEmail(side({ authEmail: "9689@phone.barq.internal", authEmailVerified: true }))).toBe(false);
    expect(hasRealVerifiedEmail(side({ authEmail: null, authEmailVerified: true }))).toBe(false);
  });
});

describe("assessEligibility — blocking rules", () => {
  it("blocks when the CURRENT identity has a privileged profile", () => {
    const r = assessEligibility(side({ userId: "B", hasPrivilege: true }), phoneSide);
    expect(r).toEqual({ eligible: false, reason: "PRIVILEGE" });
  });

  it("blocks when the OWNER identity has a privileged profile", () => {
    const r = assessEligibility(emailSide, side({ userId: "A", hasPrivilege: true }));
    expect(r).toEqual({ eligible: false, reason: "PRIVILEGE" });
  });

  it("blocks only when NEITHER identity is a full customer (no valid survivor)", () => {
    const r = assessEligibility(
      side({ userId: "B", hasCustomer: false }),
      side({ userId: "A", hasCustomer: false })
    );
    expect(r).toEqual({ eligible: false, reason: "NOT_CUSTOMER" });
  });

  it("AUTH-LEGACY-CONVERGENCE-1: a single Customer-less legacy owner is the LOSER, not a blocker", () => {
    // Current B is a full customer; legacy owner A has a verified phone but no Customer.
    const legacyOwner = side({ userId: "A", authUserId: "aA", hasCustomer: false, authPhone: "+96891112222", authPhoneVerified: true });
    const r = assessEligibility(side({ userId: "B", hasCustomer: true }), legacyOwner);
    expect(r.eligible).toBe(true);
    if (r.eligible) {
      expect(r.survivor.userId).toBe("B"); // the full customer survives
      expect(r.loser.userId).toBe("A"); // the legacy Customer-less identity loses
    }
  });

  it("a Customer-less legacy owner still BLOCKS when it carries a privileged profile", () => {
    for (const priv of [{ hasPrivilege: true }] as const) {
      const owner = side({ userId: "A", hasCustomer: false, ...priv });
      expect(assessEligibility(side({ userId: "B", hasCustomer: true }), owner)).toEqual({ eligible: false, reason: "PRIVILEGE" });
    }
  });

  it("blocks when BOTH full customers hold meaningful history", () => {
    const r = assessEligibility(
      side({ userId: "B", hasCustomer: true, hasMeaningfulHistory: true }),
      side({ userId: "A", hasCustomer: true, hasMeaningfulHistory: true })
    );
    expect(r).toEqual({ eligible: false, reason: "BOTH_HISTORY" });
  });

  it("blocks a same-identity call", () => {
    const r = assessEligibility(emailSide, emailSide);
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("SAME_IDENTITY");
  });
});

describe("assessEligibility — survivor determinism", () => {
  it("the sole history-holder survives (owner has history)", () => {
    const r = assessEligibility(emailSide, side({ userId: "A", authUserId: "aA", hasMeaningfulHistory: true }));
    expect(r.eligible).toBe(true);
    if (r.eligible) {
      expect(r.survivor.userId).toBe("A");
      expect(r.loser.userId).toBe("B");
    }
  });

  it("the sole history-holder survives (current has history)", () => {
    const r = assessEligibility(side({ userId: "B", authUserId: "aB", hasMeaningfulHistory: true }), phoneSide);
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.survivor.userId).toBe("B");
  });

  it("when neither has history, the OLDER identity survives — never the current session", () => {
    const older = side({ userId: "A", authUserId: "aA", createdAt: new Date("2025-01-01T00:00:00Z") });
    const newer = side({ userId: "B", authUserId: "aB", createdAt: new Date("2026-06-01T00:00:00Z") });
    // current = newer, owner = older → older (owner) survives
    const r1 = assessEligibility(newer, older);
    expect(r1.eligible && r1.survivor.userId).toBe("A");
    // current = older, owner = newer → older (current) survives
    const r2 = assessEligibility(older, newer);
    expect(r2.eligible && r2.survivor.userId).toBe("A");
  });
});
