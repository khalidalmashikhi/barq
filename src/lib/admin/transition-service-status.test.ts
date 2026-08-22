import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 2.3 (Service Foundation) — regression tests for admin-side
// publishService/unpublishService/archiveService. Mirrors
// src/lib/provider/transition-service-status.test.ts exactly, swapping
// requireApprovedProvider() for requireAdmin() and dropping the
// ownership re-check (an Admin may transition any Service).

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();
// TOUR-VEHICLE-2P — the shared publish authority now reads the Experience row (and, for a
// transport tour, the vehicle pool). These admin publish tests are non-tour, so the
// Experience defaults to null (no vehicle blocker).
const experienceFindUniqueMock = vi.fn();
const poolFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    price: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    experience: { findUnique: (...args: unknown[]) => experienceFindUniqueMock(...args) },
    tourServiceVehicle: { findMany: (...args: unknown[]) => poolFindManyMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { publishService, unpublishService, archiveService } = await import("./transition-service-status");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

beforeEach(() => {
  experienceFindUniqueMock.mockResolvedValue(null); // non-tour by default
});

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
  experienceFindUniqueMock.mockReset();
  poolFindManyMock.mockReset();
});

describe("publishService (admin)", () => {
  it("updates status to PUBLISHED and records an audit event, in the same transaction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue({ id: "price-1" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: SERVICE_ID }, data: { status: "PUBLISHED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "service.published",
        entityType: "Service",
        entityId: SERVICE_ID,
        previousValue: { status: "DRAFT" },
        newValue: { status: "PUBLISHED" },
      }),
    });
  });

  it("returns NO_ACTIVE_PRICE (only) when the service is categorized but has no ACTIVE price", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue(null);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_CATEGORY_REQUIRED when the service is priced but uncategorized (BR-026)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue({ id: "price-1" });

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_CATEGORY_REQUIRED", blockers: ["SERVICE_CATEGORY_REQUIRED"] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns BOTH blockers, category first, when uncategorized and priceless", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue(null);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({
      ok: false,
      error: "SERVICE_CATEGORY_REQUIRED",
      blockers: ["SERVICE_CATEGORY_REQUIRED", "NO_ACTIVE_PRICE"],
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe("unpublishService (admin)", () => {
  it("updates status to PAUSED and records action service.unpublished", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "PUBLISHED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await unpublishService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "service.unpublished", newValue: { status: "PAUSED" } }),
    });
  });
});

describe("archiveService (admin)", () => {
  it("updates status to ARCHIVED and records action service.archived", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "DRAFT" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "service.archived", newValue: { status: "ARCHIVED" } }),
    });
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses a second archive attempt (terminal state)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, status: "ARCHIVED" });

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
