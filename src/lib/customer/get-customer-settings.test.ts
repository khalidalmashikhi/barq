import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { customer: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

const requireAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAuth: (...args: unknown[]) => requireAuthMock(...args) }));

const { getCustomerSettings } = await import("./get-customer-settings");

afterEach(() => {
  findUniqueMock.mockReset();
  requireAuthMock.mockReset();
});

describe("getCustomerSettings", () => {
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
