import { describe, it, expect, vi, beforeEach } from "vitest";

// STAFF RBAC (Gate Z-3) — the authorization core: OWNER=all, ADMIN=all-domain (compat),
// STAFF=granted-only, deactivated/none=denied; requireOwner is OWNER-only.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) { super(m); this.code = c; }
  }
  return { requireAuth: vi.fn(), adminFind: vi.fn(), staffFind: vi.fn(), ForbiddenError };
});

vi.mock("./rbac", () => ({ requireAuth: (...a: unknown[]) => h.requireAuth(...a) }));
vi.mock("./errors", () => ({ ForbiddenError: h.ForbiddenError }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/db", () => ({
  prisma: {
    admin: { findUnique: (...a: unknown[]) => h.adminFind(...a) },
    staff: { findUnique: (...a: unknown[]) => h.staffFind(...a) },
  },
}));

const { requirePermission, requireOwner, resolveInternalActor, getEffectivePermissions, hasPermission } = await import("./require-permission");
const { PERMISSION_KEYS } = await import("./permissions");

const USER = { id: "u1" } as never;

beforeEach(() => {
  h.requireAuth.mockReset();
  h.adminFind.mockReset();
  h.staffFind.mockReset();
  h.requireAuth.mockResolvedValue({ barqUser: USER });
  h.adminFind.mockResolvedValue(null);
  h.staffFind.mockResolvedValue(null);
});

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: "INTERNAL_FORBIDDEN" });
}

describe("requirePermission", () => {
  it("OWNER → allowed for any permission", async () => {
    h.adminFind.mockResolvedValue({ id: "a1", status: "ACTIVE", level: "OWNER" });
    const { actor } = await requirePermission("finance.manage");
    expect(actor.kind).toBe("ADMIN");
    expect(actor.isOwner).toBe(true);
    expect(actor.actorType).toBe("ADMIN");
    expect(actor.actorId).toBe("a1");
  });

  it("non-owner ADMIN → allowed for any DOMAIN permission (compatibility)", async () => {
    h.adminFind.mockResolvedValue({ id: "a2", status: "ACTIVE", level: "ADMIN" });
    const { actor } = await requirePermission("providers.review");
    expect(actor.kind).toBe("ADMIN");
    expect(actor.isOwner).toBe(false);
  });

  it("ACTIVE STAFF → allowed only for granted keys, denied otherwise", async () => {
    h.staffFind.mockResolvedValue({ id: "s1", status: "ACTIVE", permissions: ["providers.read", "providers.review", "providerDocuments.read"] });
    const { actor } = await requirePermission("providers.review");
    expect(actor.kind).toBe("STAFF");
    expect(actor.actorId).toBe("s1");
    await expectForbidden(requirePermission("finance.read"));
    await expectForbidden(requirePermission("staff.read" as never)); // not even a key it could hold
  });

  it("STAFF with junk permission strings gets only the valid granted keys", async () => {
    h.staffFind.mockResolvedValue({ id: "s1", status: "ACTIVE", permissions: ["reviews.moderate", "bogus.key"] });
    await requirePermission("reviews.moderate"); // ok
    await expectForbidden(requirePermission("reviews.read")); // not granted
  });

  it("DEACTIVATED staff → denied", async () => {
    h.staffFind.mockResolvedValue({ id: "s1", status: "DEACTIVATED", permissions: ["providers.read"] });
    await expectForbidden(requirePermission("providers.read"));
  });

  it("DEACTIVATED admin → denied (does not fall back to staff)", async () => {
    h.adminFind.mockResolvedValue({ id: "a1", status: "DEACTIVATED", level: "OWNER" });
    await expectForbidden(requirePermission("bookings.read"));
  });

  it("no internal row (customer/provider) → denied", async () => {
    await expectForbidden(requirePermission("bookings.read"));
  });

  it("an ACTIVE Admin dominates a Staff row on the same user", async () => {
    h.adminFind.mockResolvedValue({ id: "a1", status: "ACTIVE", level: "ADMIN" });
    h.staffFind.mockResolvedValue({ id: "s1", status: "ACTIVE", permissions: [] });
    const { actor } = await requirePermission("content.manage");
    expect(actor.kind).toBe("ADMIN");
  });
});

describe("requireOwner", () => {
  it("OWNER → allowed", async () => {
    h.adminFind.mockResolvedValue({ id: "a1", status: "ACTIVE", level: "OWNER" });
    const { admin } = await requireOwner();
    expect(admin.id).toBe("a1");
  });
  it("non-owner ADMIN → denied (cannot administer staff/permissions)", async () => {
    h.adminFind.mockResolvedValue({ id: "a2", status: "ACTIVE", level: "ADMIN" });
    await expectForbidden(requireOwner());
  });
  it("STAFF (even with all permissions) → denied", async () => {
    h.staffFind.mockResolvedValue({ id: "s1", status: "ACTIVE", permissions: [...PERMISSION_KEYS] });
    await expectForbidden(requireOwner());
  });
});

describe("resolveInternalActor / getEffectivePermissions / hasPermission", () => {
  it("resolveInternalActor returns null for a non-internal user", async () => {
    expect(await resolveInternalActor(USER)).toBeNull();
  });
  it("getEffectivePermissions: ALL for admin, granted subset for staff, [] otherwise", async () => {
    h.adminFind.mockResolvedValue({ id: "a1", status: "ACTIVE", level: "ADMIN" });
    expect(await getEffectivePermissions(USER)).toEqual([...PERMISSION_KEYS]);
    h.adminFind.mockResolvedValue(null);
    h.staffFind.mockResolvedValue({ id: "s1", status: "ACTIVE", permissions: ["reviews.read", "reviews.moderate"] });
    expect(await getEffectivePermissions(USER)).toEqual(["reviews.read", "reviews.moderate"]);
    h.staffFind.mockResolvedValue(null);
    expect(await getEffectivePermissions(USER)).toEqual([]);
  });
  it("hasPermission reflects the actor", async () => {
    h.staffFind.mockResolvedValue({ id: "s1", status: "ACTIVE", permissions: ["bookings.read"] });
    expect(await hasPermission(USER, "bookings.read")).toBe(true);
    expect(await hasPermission(USER, "bookings.cancel")).toBe(false);
  });
});
