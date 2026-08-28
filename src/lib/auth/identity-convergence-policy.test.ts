import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./linked-email", () => ({
  isSyntheticAuthEmail: (e: string | null | undefined) => typeof e === "string" && e.toLowerCase().endsWith("@phone.barq.internal"),
}));

const { assessEligibility, hasRealVerifiedEmail, classifyConvergence, isSafeToRetire } = await import(
  "./identity-convergence-policy"
);
type IdentitySide = import("./identity-convergence-policy").IdentitySide;

// AUTH-IDENTITY-CONVERGENCE-1 / AUTH-PROVIDER-LINK gate 1 — pure policy.

function side(over: Partial<IdentitySide>): IdentitySide {
  const hasProvider = over.hasProvider ?? false;
  const hasStaffOrAdmin = over.hasStaffOrAdmin ?? false;
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
    hasCustomer: true,
    customerId: "c-x",
    hasMeaningfulHistory: false,
    ...over,
    // Keep the privilege trio internally consistent: any role OR an explicit hasPrivilege.
    hasProvider,
    hasStaffOrAdmin,
    hasPrivilege: hasProvider || hasStaffOrAdmin || over.hasPrivilege === true,
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

describe("classifyConvergence — customer convergence vs provider credential link (gate 1)", () => {
  const ordinaryB = side({ userId: "B", authUserId: "aB", authEmail: "b@x.com", authEmailVerified: true, hasCustomer: true });
  const providerA = side({
    userId: "A",
    authUserId: "aA",
    authPhone: "+96891112222",
    authPhoneVerified: true,
    hasProvider: true,
    hasCustomer: false,
  });

  it("ordinary customer owner → CUSTOMER_CONVERGENCE (unchanged)", () => {
    const ownerCustomer = side({ userId: "A", authUserId: "aA", authPhone: "+96891112222", authPhoneVerified: true, hasMeaningfulHistory: true });
    const r = classifyConvergence(ordinaryB, ownerCustomer);
    expect(r.kind).toBe("CUSTOMER_CONVERGENCE");
  });

  it("Provider owner + safe ordinary B → PROVIDER_CREDENTIAL_LINK (provider survives)", () => {
    const r = classifyConvergence(ordinaryB, providerA);
    expect(r.kind).toBe("PROVIDER_CREDENTIAL_LINK");
    if (r.kind === "PROVIDER_CREDENTIAL_LINK") {
      expect(r.survivor.userId).toBe("A"); // the provider survives
      expect(r.loser.userId).toBe("B");
    }
  });

  it("Provider owner + B with meaningful history → SUPPORT_REQUIRED / CURRENT_HISTORY_UNSAFE", () => {
    const r = classifyConvergence(side({ ...ordinaryB, hasMeaningfulHistory: true }), providerA);
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "CURRENT_HISTORY_UNSAFE" });
  });

  it("Provider owner + B is itself a Provider → SUPPORT_REQUIRED / CURRENT_PRIVILEGED", () => {
    const r = classifyConvergence(side({ ...ordinaryB, hasProvider: true }), providerA);
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "CURRENT_PRIVILEGED" });
  });

  it("Provider owner + B Staff → SUPPORT_REQUIRED / STAFF_ADMIN_BLOCKED", () => {
    const r = classifyConvergence(side({ ...ordinaryB, hasStaffOrAdmin: true }), providerA);
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "STAFF_ADMIN_BLOCKED" });
  });

  it("Provider owner + B without a real email → SUPPORT_REQUIRED / OWNER_NOT_LINKABLE", () => {
    const r = classifyConvergence(side({ userId: "B", authUserId: "aB", authEmail: null, hasCustomer: true }), providerA);
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "OWNER_NOT_LINKABLE" });
  });

  it("Provider+Staff owner → SUPPORT_REQUIRED / STAFF_ADMIN_BLOCKED (no self-service)", () => {
    const r = classifyConvergence(ordinaryB, side({ ...providerA, hasStaffOrAdmin: true }));
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "STAFF_ADMIN_BLOCKED" });
  });

  it("Provider+Admin owner → SUPPORT_REQUIRED / STAFF_ADMIN_BLOCKED", () => {
    const r = classifyConvergence(ordinaryB, side({ ...providerA, hasStaffOrAdmin: true }));
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "STAFF_ADMIN_BLOCKED" });
  });

  it("Staff-only owner → SUPPORT_REQUIRED / STAFF_ADMIN_BLOCKED", () => {
    const staffOwner = side({ userId: "A", authUserId: "aA", authPhone: "+96891112222", authPhoneVerified: true, hasStaffOrAdmin: true, hasCustomer: false });
    expect(classifyConvergence(ordinaryB, staffOwner)).toEqual({ kind: "SUPPORT_REQUIRED", reason: "STAFF_ADMIN_BLOCKED" });
  });

  it("Admin-only owner → SUPPORT_REQUIRED / STAFF_ADMIN_BLOCKED", () => {
    const adminOwner = side({ userId: "A", authUserId: "aA", authPhone: "+96891112222", authPhoneVerified: true, hasStaffOrAdmin: true, hasCustomer: false });
    expect(classifyConvergence(ordinaryB, adminOwner)).toEqual({ kind: "SUPPORT_REQUIRED", reason: "STAFF_ADMIN_BLOCKED" });
  });

  it("both full customers, both history → SUPPORT_REQUIRED / BOTH_HISTORY (customer reason preserved)", () => {
    const r = classifyConvergence(
      side({ userId: "B", authUserId: "aB", hasCustomer: true, hasMeaningfulHistory: true }),
      side({ userId: "A", authUserId: "aA", hasCustomer: true, hasMeaningfulHistory: true })
    );
    expect(r).toEqual({ kind: "SUPPORT_REQUIRED", reason: "BOTH_HISTORY" });
  });
});

describe("isSafeToRetire", () => {
  it("true only for a non-privileged, zero-history identity", () => {
    expect(isSafeToRetire(side({ hasCustomer: true }))).toBe(true);
    expect(isSafeToRetire(side({ hasProvider: true }))).toBe(false);
    expect(isSafeToRetire(side({ hasStaffOrAdmin: true }))).toBe(false);
    expect(isSafeToRetire(side({ hasMeaningfulHistory: true }))).toBe(false);
  });
});
