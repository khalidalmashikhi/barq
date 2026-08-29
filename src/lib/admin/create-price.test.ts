import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.5 (Pricing Foundation) — regression tests for createPrice(),
// the "first price for a service" half of the admin pricing flow.

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
const priceFindFirstMock = vi.fn();
const priceCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => serviceFindUniqueMock(...args),
    },
    price: {
      findFirst: (...args: unknown[]) => priceFindFirstMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        price: { create: (...args: unknown[]) => priceCreateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createPrice } = await import("./create-price");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  // A new ACTIVE price now REQUIRES a governed, bookable pricing unit; default it so
  // amount-focused tests still create. Unit-contract tests pass it explicitly.
  const withDefaults = { pricingUnit: "PER_PERSON", ...fields };
  for (const [key, value] of Object.entries(withDefaults)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  serviceFindUniqueMock.mockReset();
  priceFindFirstMock.mockReset();
  priceCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createPrice", () => {
  it("returns INVALID_INPUT for a malformed serviceId without checking admin status", async () => {
    const result = await createPrice(buildFormData({ serviceId: "not-a-uuid", amount: "10" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a malformed amount", async () => {
    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "not-a-number" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a zero or negative amount", async () => {
    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "0" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "10" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(priceCreateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue(null);

    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "10" }));

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(priceCreateMock).not.toHaveBeenCalled();
  });

  it("returns PRICE_ALREADY_ACTIVE when the service already has an ACTIVE price", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue({ id: SERVICE_ID });
    priceFindFirstMock.mockResolvedValue({ id: "existing-price" });

    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "10" }));

    expect(result).toEqual({ ok: false, error: "PRICE_ALREADY_ACTIVE" });
    expect(priceCreateMock).not.toHaveBeenCalled();
  });

  it("creates the price in OMR and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue({ id: SERVICE_ID });
    priceFindFirstMock.mockResolvedValue(null);
    priceCreateMock.mockResolvedValue({ id: "price-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "25.50" }));

    expect(result).toEqual({ ok: true, priceId: "price-1" });
    expect(priceCreateMock).toHaveBeenCalledWith({
      data: { serviceId: SERVICE_ID, amount: "25.50", currency: "OMR", pricingUnit: "PER_PERSON" },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "price.created",
        entityType: "Price",
        entityId: "price-1",
        newValue: expect.objectContaining({ status: "ACTIVE", pricingUnit: "PER_PERSON" }),
      }),
    });
  });

  // PRICING UNIT DATA INTEGRITY — a new admin price must carry a governed, bookable unit.
  it.each([
    ["absent/empty", ""],
    ["unknown", "PER_LIGHT_YEAR"],
    ["reserved duration (PER_DAY)", "PER_DAY"],
    ["reserved duration (PER_HOUR)", "PER_HOUR"],
  ])("rejects a %s pricing unit with PRICING_UNIT_REQUIRED, creating nothing", async (_label, unit) => {
    serviceFindUniqueMock.mockResolvedValue({ id: SERVICE_ID });
    priceFindFirstMock.mockResolvedValue(null);

    const result = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "10", pricingUnit: unit }));

    expect(result).toEqual({ ok: false, error: "PRICING_UNIT_REQUIRED" });
    expect(priceCreateMock).not.toHaveBeenCalled();
  });
});
