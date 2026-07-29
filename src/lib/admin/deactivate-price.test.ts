import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.5 (Pricing Foundation) — regression tests for
// deactivatePrice(), the one-way ACTIVE -> SUPERSEDED transition with
// no replacement.

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

const priceFindUniqueMock = vi.fn();
const priceUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    price: {
      findUnique: (...args: unknown[]) => priceFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        price: { update: (...args: unknown[]) => priceUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { deactivatePrice } = await import("./deactivate-price");

const PRICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  priceFindUniqueMock.mockReset();
  priceUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("deactivatePrice", () => {
  it("returns INVALID_INPUT for a malformed priceId without checking admin status", async () => {
    const result = await deactivatePrice("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await deactivatePrice(PRICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(priceUpdateMock).not.toHaveBeenCalled();
  });

  it("returns PRICE_NOT_FOUND when the price doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    priceFindUniqueMock.mockResolvedValue(null);

    const result = await deactivatePrice(PRICE_ID);

    expect(result).toEqual({ ok: false, error: "PRICE_NOT_FOUND" });
    expect(priceUpdateMock).not.toHaveBeenCalled();
  });

  it("returns NO_ACTIVE_PRICE when the price is already SUPERSEDED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    priceFindUniqueMock.mockResolvedValue({ id: PRICE_ID, status: "SUPERSEDED" });

    const result = await deactivatePrice(PRICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_ACTIVE_PRICE" });
    expect(priceUpdateMock).not.toHaveBeenCalled();
  });

  it("supersedes an ACTIVE price and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    priceFindUniqueMock.mockResolvedValue({ id: PRICE_ID, status: "ACTIVE" });
    priceUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await deactivatePrice(PRICE_ID);

    expect(result).toEqual({ ok: true });
    expect(priceUpdateMock).toHaveBeenCalledWith({ where: { id: PRICE_ID }, data: { status: "SUPERSEDED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "price.deactivated",
        entityType: "Price",
        entityId: PRICE_ID,
        newValue: { status: "SUPERSEDED" },
      }),
    });
  });
});
