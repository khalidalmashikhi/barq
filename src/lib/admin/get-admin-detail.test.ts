import { describe, it, expect, vi, afterEach } from "vitest";

// User & Access Management (Batch 6) — regression tests for getAdminDetail():
// last-login derivation, "granted by" from the earliest admin.granted event,
// and the legacy fallback when no grant event exists.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));

const adminFindUniqueMock = vi.fn();
const auditFindFirstMock = vi.fn();
const sessionFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    admin: { findUnique: (...a: unknown[]) => adminFindUniqueMock(...a) },
    auditLog: { findFirst: (...a: unknown[]) => auditFindFirstMock(...a) },
    session: { findFirst: (...a: unknown[]) => sessionFindFirstMock(...a) },
  },
}));

const { getAdminDetail } = await import("./get-admin-detail");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const LOGIN = new Date("2026-07-01T10:00:00Z");

afterEach(() => {
  requireAdminMock.mockReset();
  adminFindUniqueMock.mockReset();
  auditFindFirstMock.mockReset();
  sessionFindFirstMock.mockReset();
});

const TARGET = { id: ID, userId: "user-1", status: "ACTIVE", createdAt: new Date(), user: { phoneNumber: "+96890000001", authUserId: "auth-1" } };

describe("getAdminDetail", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin role required"));
    await expect(getAdminDetail(ID)).rejects.toThrow(/Admin role required/);
  });

  it("returns null for a non-UUID id and for a missing admin", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    expect(await getAdminDetail("nope")).toBeNull();
    adminFindUniqueMock.mockResolvedValueOnce(null);
    expect(await getAdminDetail(ID)).toBeNull();
  });

  it("derives last login from the most recent session and 'granted by' from the earliest admin.granted event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    adminFindUniqueMock.mockResolvedValueOnce(TARGET); // target admin
    sessionFindFirstMock.mockResolvedValue({ createdAt: LOGIN });
    auditFindFirstMock.mockResolvedValue({ actorId: "grantor-admin" });
    adminFindUniqueMock.mockResolvedValueOnce({ user: { phoneNumber: "+96890009999" } }); // grantor

    const result = await getAdminDetail(ID);

    expect(result).toEqual(
      expect.objectContaining({ id: ID, phoneNumber: "+96890000001", status: "ACTIVE", lastLoginAt: LOGIN, grantedByPhone: "+96890009999" })
    );
    expect(auditFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: "Admin", entityId: ID, action: "admin.granted" }, orderBy: { createdAt: "asc" } })
    );
  });

  it("shows the legacy fallback (grantedByPhone null) when no grant event exists, and 'Never' login when no sessions", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    adminFindUniqueMock.mockResolvedValueOnce(TARGET);
    sessionFindFirstMock.mockResolvedValue(null);
    auditFindFirstMock.mockResolvedValue(null);

    const result = await getAdminDetail(ID);

    expect(result?.grantedByPhone).toBeNull();
    expect(result?.lastLoginAt).toBeNull();
  });
});
