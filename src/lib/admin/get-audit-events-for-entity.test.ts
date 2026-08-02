import { describe, it, expect, vi, afterEach } from "vitest";

// User & Access Management (Batch 6) — regression tests for
// getAuditEventsForEntity().

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { auditLog: { findMany: (...a: unknown[]) => findManyMock(...a) } } }));

const { getAuditEventsForEntity } = await import("./get-audit-events-for-entity");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
});

describe("getAuditEventsForEntity", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin role required"));
    await expect(getAuditEventsForEntity("Admin", ID)).rejects.toThrow(/Admin role required/);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns [] for a non-UUID entityId without querying", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    expect(await getAuditEventsForEntity("Admin", "not-a-uuid")).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("filters by entityType+entityId, orders newest first, and caps the result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue([
      { id: "e1", action: "admin.granted", actorType: "ADMIN", actorId: "a1", previousValue: null, newValue: { status: "ACTIVE" }, createdAt: new Date() },
    ]);

    const result = await getAuditEventsForEntity("Admin", ID, 25);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: "Admin", entityId: ID },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
      })
    );
    expect(result[0]).toEqual(expect.objectContaining({ action: "admin.granted", actorType: "ADMIN", actorId: "a1" }));
  });

  it("defaults the cap to 50 when not provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue([]);
    await getAuditEventsForEntity("Staff", ID);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});
