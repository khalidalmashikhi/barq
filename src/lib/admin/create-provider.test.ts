import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2 (Provider Foundation) — regression tests for createProvider(),
// the admin-initiated direct creation path, distinct from the
// pre-existing self-service apply-as-provider.ts flow.

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

const userFindUniqueMock = vi.fn();
const providerFindUniqueMock = vi.fn();
const providerCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        provider: { create: (...args: unknown[]) => providerCreateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createProvider } = await import("./create-provider");

const USER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    userId: USER_ID,
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
  userFindUniqueMock.mockReset();
  providerFindUniqueMock.mockReset();
  providerCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createProvider", () => {
  it("returns INVALID_INPUT for a malformed userId without checking admin status", async () => {
    const result = await createProvider(buildFormData(baseFields({ userId: "not-a-uuid" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a blank business name", async () => {
    const result = await createProvider(buildFormData(baseFields({ nameAr: "  ", nameEn: "" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a malformed slug", async () => {
    const result = await createProvider(buildFormData(baseFields({ slug: "Not A Slug!" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a malformed contact email", async () => {
    const result = await createProvider(buildFormData(baseFields({ contactEmail: "not-an-email" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns INVALID_INPUT for a malformed logo URL", async () => {
    const result = await createProvider(buildFormData(baseFields({ logoUrl: "not-a-url" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createProvider(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(providerCreateMock).not.toHaveBeenCalled();
  });

  it("returns USER_NOT_FOUND when the target user doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue(null);

    const result = await createProvider(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "USER_NOT_FOUND" });
    expect(providerCreateMock).not.toHaveBeenCalled();
  });

  it("returns USER_ALREADY_HAS_PROVIDER_PROFILE when the user already has a Provider row", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    providerFindUniqueMock.mockResolvedValue({ id: "existing-provider" });

    const result = await createProvider(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "USER_ALREADY_HAS_PROVIDER_PROFILE" });
    expect(providerCreateMock).not.toHaveBeenCalled();
  });

  it("returns SLUG_TAKEN without creating anything when the slug already exists", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    providerFindUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "slug-owner" });

    const result = await createProvider(buildFormData(baseFields({ slug: "trips-co" })));

    expect(result).toEqual({ ok: false, error: "SLUG_TAKEN" });
    expect(providerCreateMock).not.toHaveBeenCalled();
  });

  it("creates the provider APPLIED by default and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    providerFindUniqueMock.mockResolvedValue(null);
    providerCreateMock.mockResolvedValue({ id: "provider-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createProvider(
      buildFormData(baseFields({ slug: "trips-co", contactEmail: "ops@trips.example", city: "Muscat" }))
    );

    expect(result).toEqual({ ok: true, providerId: "provider-1" });
    expect(providerCreateMock).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        businessName: { ar: "شركة الرحلات", en: "Trips Co" },
        businessDescription: undefined,
        slug: "trips-co",
        contactEmail: "ops@trips.example",
        city: "Muscat",
        logoUrl: undefined,
      },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "provider.created",
        entityType: "Provider",
        entityId: "provider-1",
        newValue: expect.objectContaining({ status: "APPLIED" }),
      }),
    });
  });
});
