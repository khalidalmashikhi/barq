import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { customer: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

const requireAuthMock = vi.fn();
const assertNotActiveAdminMock = vi.fn();

class ForbiddenError extends Error {
  code?: string;
  constructor(message?: string, code?: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  assertNotActiveAdmin: (...args: unknown[]) => assertNotActiveAdminMock(...args),
  ForbiddenError,
}));

const { getCustomerSettings } = await import("./get-customer-settings");

afterEach(() => {
  findUniqueMock.mockReset();
  requireAuthMock.mockReset();
  assertNotActiveAdminMock.mockReset();
});

describe("getCustomerSettings", () => {
  it("Gate A: denies an ACTIVE admin at the domain layer, before any Customer read", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user" } });
    assertNotActiveAdminMock.mockRejectedValue(new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY"));

    const error = await getCustomerSettings().catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("ADMIN_BACKOFFICE_ONLY");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns the display name, phone, and language preference", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "u1", name: "Layla", phoneNumber: "+96890000000" } });
    findUniqueMock.mockResolvedValue({ languagePreference: "ar" });

    expect(await getCustomerSettings()).toEqual({ name: "Layla", phoneNumber: "+96890000000", languagePreference: "ar" });
  });

  it("falls back to empty strings when name is null and no Customer row exists", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "u1", name: null, phoneNumber: "+96890000000" } });
    findUniqueMock.mockResolvedValue(null);

    expect(await getCustomerSettings()).toEqual({ name: "", phoneNumber: "+96890000000", languagePreference: "" });
  });
});
