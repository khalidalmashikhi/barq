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

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
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

  it("creates a Provider row with status APPLIED for a valid, new application", async () => {
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
        status: "APPLIED",
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
        status: "APPLIED",
      },
    });
  });

  it("returns UNKNOWN_ERROR when an unexpected exception occurs", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-4" } });
    findUniqueMock.mockRejectedValue(new Error("db unavailable"));

    const result = await applyAsProvider(buildFormData({ businessNameAr: "شركة", businessNameEn: "Acme" }));

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});
