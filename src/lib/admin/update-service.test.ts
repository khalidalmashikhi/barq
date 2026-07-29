import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.3 (Service Foundation) — regression tests for updateService(),
// the admin-initiated edit path. No ownership check (an Admin manages
// every Service), unlike the pre-existing self-service
// src/lib/provider/update-service.ts.

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

const serviceFindUniqueMock = vi.fn();
const serviceUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => serviceFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => serviceUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updateService } = await import("./update-service");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  serviceFindUniqueMock.mockReset();
  serviceUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateService", () => {
  it("returns INVALID_INPUT for a malformed serviceId without checking admin status", async () => {
    const result = await updateService("not-a-uuid", buildFormData({ nameAr: "أ", nameEn: "A" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a blank name", async () => {
    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "  ", nameEn: "" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "أ", nameEn: "A" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue(null);

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "أ", nameEn: "A" }));

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("updates name/description and records an audit event, without touching status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue({
      id: SERVICE_ID,
      name: { ar: "قديم", en: "Old" },
      status: "DRAFT",
    });
    serviceUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateService(
      SERVICE_ID,
      buildFormData({ nameAr: "جديد", nameEn: "New", descriptionAr: "", descriptionEn: "Updated desc" })
    );

    expect(result).toEqual({ ok: true });
    expect(serviceUpdateMock).toHaveBeenCalledWith({
      where: { id: SERVICE_ID },
      data: {
        name: { ar: "جديد", en: "New" },
        description: { ar: "", en: "Updated desc" },
      },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "service.updated",
        entityType: "Service",
        entityId: SERVICE_ID,
      }),
    });
  });
});
