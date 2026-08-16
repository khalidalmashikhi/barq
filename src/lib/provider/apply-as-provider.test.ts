import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.1 (Production Readiness — self-service signup) — regression
// tests for applyAsProvider(). Mocks requireAuth (not requireProvider —
// applying is precisely how a User becomes a Provider) and prisma the
// same way other action-level tests in this codebase mock @/lib/db,
// establishing the pattern for src/lib/provider/*.ts action tests
// (none existed before this phase).

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

const findUniqueMock = vi.fn();
const createMock = vi.fn();
const createManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        provider: { create: (...args: unknown[]) => createMock(...args) },
        providerCategory: { createMany: (...args: unknown[]) => createManyMock(...args) },
      }),
  },
}));

const assertAssignableCategoryMock = vi.fn();
vi.mock("@/lib/categories/assert-assignable-category", () => ({
  assertAssignableCategory: (...args: unknown[]) => assertAssignableCategoryMock(...args),
}));

const { applyAsProvider } = await import("./apply-as-provider");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAuthMock.mockReset();
  findUniqueMock.mockReset();
  createMock.mockReset();
  createManyMock.mockReset();
  assertAssignableCategoryMock.mockReset();
});

describe("applyAsProvider", () => {
  it("returns INVALID_INPUT when businessNameAr or businessNameEn is missing or blank", async () => {
    const result = await applyAsProvider(buildFormData({ businessNameAr: "", businessNameEn: "Acme" }));
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAuthMock).not.toHaveBeenCalled();
  });

  it("returns ALREADY_HAS_PROVIDER_PROFILE when the user already has a Provider row", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1" });

    const result = await applyAsProvider(buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" }));

    expect(result).toEqual({ ok: false, error: "ALREADY_HAS_PROVIDER_PROFILE" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates a Provider row with status DRAFT (Gate 1A: not submitted until explicit Submit) for a valid, new application", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-2" } });
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "provider-2" });

    const result = await applyAsProvider(
      buildFormData({
        businessNameAr: "شركة",
        businessNameEn: "Acme",
        businessDescriptionAr: "وصف",
        businessDescriptionEn: "Description",
      })
    );

    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId: "user-2",
        businessName: { ar: "شركة", en: "Acme" },
        businessDescription: { ar: "وصف", en: "Description" },
        providerType: "COMPANY",
        status: "DRAFT",
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("omits businessDescription when both language fields are blank", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-3" } });
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "provider-3" });

    await applyAsProvider(buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" }));

    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId: "user-3",
        businessName: { ar: "شركة", en: "Acme" },
        businessDescription: undefined,
        providerType: "COMPANY",
        status: "DRAFT",
      },
    });
  });

  it("defaults providerType to COMPANY when no type is submitted (backward-compatible)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-7" } });
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "provider-7" });

    await applyAsProvider(buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerType: "COMPANY" }) })
    );
  });

  it("persists providerType INDIVIDUAL when chosen", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-8" } });
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "provider-8" });

    const result = await applyAsProvider(
      buildFormData({ businessNameAr: "ليلى", businessNameEn: "Layla", providerType: "INDIVIDUAL" })
    );

    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerType: "INDIVIDUAL" }) })
    );
  });

  it("returns UNKNOWN_ERROR when an unexpected exception occurs", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-4" } });
    findUniqueMock.mockRejectedValue(new Error("db unavailable"));

    const result = await applyAsProvider(buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" }));

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });

  it("writes ProviderCategory rows for submitted areas, validated against the taxonomy", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-5" } });
    findUniqueMock.mockResolvedValue(null);
    assertAssignableCategoryMock.mockResolvedValue(true);
    createMock.mockResolvedValue({ id: "provider-5" });
    createManyMock.mockResolvedValue({});

    const fd = buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" });
    fd.append("categoryIds", "c1");
    fd.append("categoryIds", "c2");

    const result = await applyAsProvider(fd);

    expect(result).toEqual({ ok: true });
    expect(assertAssignableCategoryMock).toHaveBeenCalledWith("c1", "EXPERIENCE");
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        { providerId: "provider-5", categoryId: "c1" },
        { providerId: "provider-5", categoryId: "c2" },
      ],
    });
  });

  it("rejects an unassignable area with INVALID_INPUT and creates nothing", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-6" } });
    findUniqueMock.mockResolvedValue(null);
    assertAssignableCategoryMock.mockResolvedValue(false);

    const fd = buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" });
    fd.append("categoryIds", "bad");

    const result = await applyAsProvider(fd);

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
