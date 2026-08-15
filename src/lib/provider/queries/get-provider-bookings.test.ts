import { describe, it, expect, vi, beforeEach } from "vitest";

// Ownership / IDOR isolation test for the provider incoming-bookings reader
// (audit-identified gap). Every query is scoped to the session-resolved
// provider.id; a provider only ever sees their own incoming bookings.

vi.mock("server-only", () => ({}));

const getLocaleMock = vi.fn();
vi.mock("next-intl/server", () => ({ getLocale: () => getLocaleMock() }));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: () => requireProviderMock() }));

const countMock = vi.fn();
const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { booking: { count: (...a: unknown[]) => countMock(...a), findMany: (...a: unknown[]) => findManyMock(...a) } },
}));

const { getProviderBookings } = await import("./get-provider-bookings");

beforeEach(() => {
  getLocaleMock.mockReset().mockResolvedValue("en");
  requireProviderMock.mockReset().mockResolvedValue({ provider: { id: "PROVIDER_1" } });
  countMock.mockReset().mockResolvedValue(0);
  findManyMock.mockReset().mockResolvedValue([]);
});

describe("getProviderBookings — ownership isolation", () => {
  it("ALWAYS scopes count + findMany to the session provider.id", async () => {
    await getProviderBookings({});
    expect(countMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerId: "PROVIDER_1" }) }));
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerId: "PROVIDER_1" }) }));
  });

  it("never accepts a providerId parameter — filters only narrow within the provider scope", async () => {
    await getProviderBookings({ status: "PENDING_PROVIDER", serviceId: "01a00172-1f8e-71b3-9fee-6e7ffd7b86f7" }, "en");
    const call = findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where.providerId).toBe("PROVIDER_1");
    expect(call.where.status).toBe("PENDING_PROVIDER");
    expect(call.where.serviceId).toBe("01a00172-1f8e-71b3-9fee-6e7ffd7b86f7");
  });

  it("malformed serviceId → empty result WITHOUT querying the DB", async () => {
    const result = await getProviderBookings({ serviceId: "not-a-uuid" });
    expect(result.totalCount).toBe(0);
    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
