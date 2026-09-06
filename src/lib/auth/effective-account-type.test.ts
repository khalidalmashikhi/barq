import { describe, it, expect, vi, beforeEach } from "vitest";

// EXCLUSIVE ACCOUNT TYPES — Gate Z-1. Proves the authoritative precedence
// (Admin>Staff>Provider>Customer>none), the inactive Admin/Staff fall-through,
// the DB resolver's status semantics (Provider classifies across its WHOLE
// lifecycle, deactivated Admin/Staff do NOT dominate), the non-creating session
// resolver, and the routing/landing maps.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  adminFindUnique: vi.fn(),
  staffFindUnique: vi.fn(),
  providerFindUnique: vi.fn(),
  customerFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    admin: { findUnique: (...a: unknown[]) => h.adminFindUnique(...a) },
    staff: { findUnique: (...a: unknown[]) => h.staffFindUnique(...a) },
    provider: { findUnique: (...a: unknown[]) => h.providerFindUnique(...a) },
    customer: { findUnique: (...a: unknown[]) => h.customerFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => h.userFindUnique(...a) },
  },
}));

vi.mock("./session", () => ({ getSession: (...a: unknown[]) => h.getSession(...a) }));

const {
  classifyEffectiveAccountType,
  resolveEffectiveAccountType,
  resolveEffectiveAccountTypeForSession,
  routeForEffectiveAccountType,
  landingRedirectForEffectiveType,
} = await import("./effective-account-type");

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  // Default: nothing present. Individual cases turn rows on.
  h.adminFindUnique.mockResolvedValue(null);
  h.staffFindUnique.mockResolvedValue(null);
  h.providerFindUnique.mockResolvedValue(null);
  h.customerFindUnique.mockResolvedValue(null);
});

describe("classifyEffectiveAccountType — pure precedence", () => {
  const snap = (o: Partial<Parameters<typeof classifyEffectiveAccountType>[0]>) => ({
    hasActiveAdmin: false,
    hasActiveStaff: false,
    hasProvider: false,
    hasCustomer: false,
    ...o,
  });

  it("Customer only → CUSTOMER", () => {
    expect(classifyEffectiveAccountType(snap({ hasCustomer: true }))).toBe("CUSTOMER");
  });
  it("Provider only → PROVIDER", () => {
    expect(classifyEffectiveAccountType(snap({ hasProvider: true }))).toBe("PROVIDER");
  });
  it("Customer + Provider → PROVIDER", () => {
    expect(classifyEffectiveAccountType(snap({ hasCustomer: true, hasProvider: true }))).toBe("PROVIDER");
  });
  it("Staff only → STAFF", () => {
    expect(classifyEffectiveAccountType(snap({ hasActiveStaff: true }))).toBe("STAFF");
  });
  it("Customer + Staff → STAFF", () => {
    expect(classifyEffectiveAccountType(snap({ hasCustomer: true, hasActiveStaff: true }))).toBe("STAFF");
  });
  it("Provider + Staff → STAFF", () => {
    expect(classifyEffectiveAccountType(snap({ hasProvider: true, hasActiveStaff: true }))).toBe("STAFF");
  });
  it("Admin only → ADMIN", () => {
    expect(classifyEffectiveAccountType(snap({ hasActiveAdmin: true }))).toBe("ADMIN");
  });
  it("Customer + Admin → ADMIN", () => {
    expect(classifyEffectiveAccountType(snap({ hasCustomer: true, hasActiveAdmin: true }))).toBe("ADMIN");
  });
  it("Provider + Admin → ADMIN", () => {
    expect(classifyEffectiveAccountType(snap({ hasProvider: true, hasActiveAdmin: true }))).toBe("ADMIN");
  });
  it("Staff + Admin → ADMIN", () => {
    expect(classifyEffectiveAccountType(snap({ hasActiveStaff: true, hasActiveAdmin: true }))).toBe("ADMIN");
  });
  it("Customer + Provider + Staff + Admin → ADMIN", () => {
    expect(
      classifyEffectiveAccountType({ hasActiveAdmin: true, hasActiveStaff: true, hasProvider: true, hasCustomer: true })
    ).toBe("ADMIN");
  });
  it("no profile → UNCLASSIFIED", () => {
    expect(classifyEffectiveAccountType(snap({}))).toBe("UNCLASSIFIED");
  });
});

describe("resolveEffectiveAccountType — DB status semantics", () => {
  it("an ACTIVE Admin dominates every other profile → ADMIN", async () => {
    h.adminFindUnique.mockResolvedValue({ status: "ACTIVE" });
    h.staffFindUnique.mockResolvedValue({ status: "ACTIVE" });
    h.providerFindUnique.mockResolvedValue({ id: "p1" });
    h.customerFindUnique.mockResolvedValue({ id: "c1" });
    expect(await resolveEffectiveAccountType("u1")).toBe("ADMIN");
  });

  it("a DEACTIVATED Admin does NOT dominate — falls through to Provider", async () => {
    h.adminFindUnique.mockResolvedValue({ status: "DEACTIVATED" });
    h.providerFindUnique.mockResolvedValue({ id: "p1" });
    h.customerFindUnique.mockResolvedValue({ id: "c1" });
    expect(await resolveEffectiveAccountType("u1")).toBe("PROVIDER");
  });

  it("a DEACTIVATED Staff does NOT dominate — a Customer+deactivated-staff resolves CUSTOMER", async () => {
    h.staffFindUnique.mockResolvedValue({ status: "DEACTIVATED" });
    h.customerFindUnique.mockResolvedValue({ id: "c1" });
    expect(await resolveEffectiveAccountType("u1")).toBe("CUSTOMER");
  });

  it("a Provider in a NON-approved lifecycle status still classifies PROVIDER (account type, not approval)", async () => {
    // The resolver only selects the provider's id, so any existing provider row (DRAFT,
    // APPLIED, UNDER_REVIEW, REJECTED, even DEACTIVATED) counts as the PROVIDER type.
    h.providerFindUnique.mockResolvedValue({ id: "p1" });
    h.customerFindUnique.mockResolvedValue({ id: "c1" });
    expect(await resolveEffectiveAccountType("u1")).toBe("PROVIDER");
  });

  it("no profiles at all → UNCLASSIFIED", async () => {
    expect(await resolveEffectiveAccountType("u1")).toBe("UNCLASSIFIED");
  });
});

describe("resolveEffectiveAccountTypeForSession — non-creating", () => {
  it("null when there is no session", async () => {
    h.getSession.mockResolvedValue(null);
    expect(await resolveEffectiveAccountTypeForSession()).toBeNull();
    expect(h.userFindUnique).not.toHaveBeenCalled();
  });

  it("null when the session has no linked BARQ User (does NOT create one)", async () => {
    h.getSession.mockResolvedValue({ user: { id: "au1" } });
    h.userFindUnique.mockResolvedValue(null);
    expect(await resolveEffectiveAccountTypeForSession()).toBeNull();
  });

  it("classifies the linked BARQ user (Provider) without creating a profile", async () => {
    h.getSession.mockResolvedValue({ user: { id: "au1" } });
    h.userFindUnique.mockResolvedValue({ id: "u1" });
    h.providerFindUnique.mockResolvedValue({ id: "p1" });
    expect(await resolveEffectiveAccountTypeForSession()).toBe("PROVIDER");
  });
});

describe("routing maps", () => {
  it("routeForEffectiveAccountType covers every type", () => {
    expect(routeForEffectiveAccountType("ADMIN")).toBe("/admin");
    expect(routeForEffectiveAccountType("STAFF")).toBe("/admin");
    expect(routeForEffectiveAccountType("PROVIDER")).toBe("/provider");
    expect(routeForEffectiveAccountType("CUSTOMER")).toBe("/dashboard");
    expect(routeForEffectiveAccountType("UNCLASSIFIED")).toBe("/onboarding");
  });

  it("landingRedirectForEffectiveType diverts ONLY ADMIN and PROVIDER", () => {
    expect(landingRedirectForEffectiveType("ADMIN")).toBe("/admin");
    expect(landingRedirectForEffectiveType("PROVIDER")).toBe("/provider");
    // Everyone else stays on the customer landing (its own completion gate handles onward).
    expect(landingRedirectForEffectiveType("STAFF")).toBeNull();
    expect(landingRedirectForEffectiveType("CUSTOMER")).toBeNull();
    expect(landingRedirectForEffectiveType("UNCLASSIFIED")).toBeNull();
    expect(landingRedirectForEffectiveType(null)).toBeNull();
  });
});
