import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

// Phase 2 (Provider Foundation) — regression tests for updateProvider(),
// mirroring update-category.test.ts's shape. Never touches
// status/userId/approvedAt/approvedByAdminId/visible.

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

const providerFindUniqueMock = vi.fn();
const providerUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        provider: { update: (...args: unknown[]) => providerUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updateProvider } = await import("./update-provider");

const PROVIDER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    nameAr: "شركة الرحلات",
    nameEn: "Trips Co",
    descriptionAr: "",
    descriptionEn: "",
    slug: "",
    contactEmail: "",
    city: "",
    logoUrl: "",
    ...overrides,
  };
}

afterEach(() => {
  requireAdminMock.mockReset();
  providerFindUniqueMock.mockReset();
  providerUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateProvider", () => {
  it("returns PROVIDER_NOT_FOUND when the provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue(null);

    const result = await updateProvider(PROVIDER_ID, buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
    expect(providerUpdateMock).not.toHaveBeenCalled();
  });

  it("returns SLUG_TAKEN when the new slug belongs to another provider", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock
      .mockResolvedValueOnce({ id: PROVIDER_ID, businessName: { ar: "a", en: "b" }, slug: "old-slug" })
      .mockResolvedValueOnce({ id: "other-provider" });

    const result = await updateProvider(PROVIDER_ID, buildFormData(baseFields({ slug: "taken-slug" })));

    expect(result).toEqual({ ok: false, error: "SLUG_TAKEN" });
    expect(providerUpdateMock).not.toHaveBeenCalled();
  });

  it("updates identity fields and records an audit event, never touching status/userId/visible", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock
      .mockResolvedValueOnce({
        id: PROVIDER_ID,
        businessName: { ar: "old ar", en: "old en" },
        slug: "old-slug",
      })
      .mockResolvedValueOnce(null);
    providerUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateProvider(
      PROVIDER_ID,
      buildFormData(baseFields({ slug: "new-slug", contactEmail: "ops@trips.example", city: "Salalah" }))
    );

    expect(result).toEqual({ ok: true });
    expect(providerUpdateMock).toHaveBeenCalledWith({
      where: { id: PROVIDER_ID },
      data: {
        businessName: { ar: "شركة الرحلات", en: "Trips Co" },
        businessDescription: Prisma.DbNull,
        slug: "new-slug",
        contactEmail: "ops@trips.example",
        city: "Salalah",
        logoUrl: null,
      },
    });
    const updateData = providerUpdateMock.mock.calls[0]?.[0].data;
    expect(updateData).not.toHaveProperty("status");
    expect(updateData).not.toHaveProperty("userId");
    expect(updateData).not.toHaveProperty("visible");
  });
});
