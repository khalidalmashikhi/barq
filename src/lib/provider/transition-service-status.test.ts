import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// publishService/unpublishService/archiveService, extended this phase
// to wrap the status update and its new audit-log write in one
// transaction. Only the shared transition() internals are exercised
// once per public entry point — service-status-policy.ts's own matrix
// is already covered by service-status-policy.test.ts.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    price: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { publishService, unpublishService, archiveService } = await import("./transition-service-status");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireProviderMock.mockReset();
  findUniqueMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("publishService", () => {
  it("updates status to PUBLISHED and records an audit event, in the same transaction", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue({ id: "price-1" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: SERVICE_ID }, data: { status: "PUBLISHED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "PROVIDER",
        actorId: "provider-1",
        action: "service.published",
        entityType: "Service",
        entityId: SERVICE_ID,
        previousValue: { status: "DRAFT" },
        newValue: { status: "PUBLISHED" },
      }),
    });
  });

  it("returns NO_ACTIVE_PRICE (only) when the service is categorized but has no ACTIVE price", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue(null);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_CATEGORY_REQUIRED when the service is priced but uncategorized (BR-026)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue({ id: "price-1" });

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_CATEGORY_REQUIRED", blockers: ["SERVICE_CATEGORY_REQUIRED"] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns BOTH blockers, category first, when uncategorized and priceless", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue(null);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({
      ok: false,
      error: "SERVICE_CATEGORY_REQUIRED",
      blockers: ["SERVICE_CATEGORY_REQUIRED", "NO_ACTIVE_PRICE"],
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("unpublishService", () => {
  it("updates status to PAUSED and records action service.unpublished", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "PUBLISHED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await unpublishService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "service.unpublished", newValue: { status: "PAUSED" } }),
    });
  });
});

describe("archiveService", () => {
  it("updates status to ARCHIVED and records action service.archived", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "service.archived", newValue: { status: "ARCHIVED" } }),
    });
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't belong to this provider", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "someone-else", status: "DRAFT" });

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
