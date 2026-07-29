import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.5 (Pricing Foundation) — regression tests for updatePrice(),
// which supersedes the current ACTIVE price and creates a new one in
// its place, in one transaction.

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

const priceFindFirstMock = vi.fn();
const priceUpdateMock = vi.fn();
const priceCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    price: {
      findFirst: (...args: unknown[]) => priceFindFirstMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        price: {
          update: (...args: unknown[]) => priceUpdateMock(...args),
          create: (...args: unknown[]) => priceCreateMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updatePrice } = await import("./update-price");

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
  priceFindFirstMock.mockReset();
  priceUpdateMock.mockReset();
  priceCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updatePrice", () => {
  it("returns INVALID_INPUT for a malformed serviceId without checking admin status", async () => {
    const result = await updatePrice("not-a-uuid", buildFormData({ amount: "10" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a malformed amount", async () => {
    const result = await updatePrice(SERVICE_ID, buildFormData({ amount: "free" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await updatePrice(SERVICE_ID, buildFormData({ amount: "10" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(priceUpdateMock).not.toHaveBeenCalled();
  });

  it("returns NO_ACTIVE_PRICE when the service has no current ACTIVE price", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    priceFindFirstMock.mockResolvedValue(null);

    const result = await updatePrice(SERVICE_ID, buildFormData({ amount: "10" }));

    expect(result).toEqual({ ok: false, error: "NO_ACTIVE_PRICE" });
    expect(priceUpdateMock).not.toHaveBeenCalled();
  });

  it("supersedes the current price, creates a new one, and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    priceFindFirstMock.mockResolvedValue({ id: "old-price", amount: "20.00", currency: "OMR" });
    priceUpdateMock.mockResolvedValue({});
    priceCreateMock.mockResolvedValue({ id: "new-price" });
    auditCreateMock.mockResolvedValue({});

    const result = await updatePrice(SERVICE_ID, buildFormData({ amount: "30" }));

    expect(result).toEqual({ ok: true, priceId: "new-price" });
    expect(priceUpdateMock).toHaveBeenCalledWith({ where: { id: "old-price" }, data: { status: "SUPERSEDED" } });
    expect(priceCreateMock).toHaveBeenCalledWith({
      data: { serviceId: SERVICE_ID, amount: "30", currency: "OMR" },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "price.updated",
        entityType: "Price",
        entityId: "new-price",
        previousValue: expect.objectContaining({ supersededPriceId: "old-price" }),
      }),
    });
  });
});
