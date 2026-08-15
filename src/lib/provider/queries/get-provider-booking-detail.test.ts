import { describe, it, expect, vi, beforeEach } from "vitest";

// Ownership / IDOR isolation test for the provider booking-detail reader
// (audit-identified gap). The query is ALWAYS scoped to the session-resolved
// provider.id — a provider can never read another provider's booking by id.

vi.mock("server-only", () => ({}));

const getLocaleMock = vi.fn();
vi.mock("next-intl/server", () => ({ getLocale: () => getLocaleMock() }));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: () => requireProviderMock() }));

const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { booking: { findFirst: (...a: unknown[]) => findFirstMock(...a) } } }));

const { getProviderBookingDetail } = await import("./get-provider-booking-detail");

beforeEach(() => {
  getLocaleMock.mockReset().mockResolvedValue("en");
  requireProviderMock.mockReset().mockResolvedValue({ provider: { id: "PROVIDER_1" } });
  findFirstMock.mockReset();
});

const UUID = "01a00172-1f8e-71b3-9fee-6e7ffd7b86f7";

describe("getProviderBookingDetail — ownership isolation", () => {
  it("returns null for a malformed id WITHOUT querying the DB", async () => {
    expect(await getProviderBookingDetail("not-a-uuid")).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("ALWAYS scopes the query to the session provider.id (never a client-supplied id)", async () => {
    findFirstMock.mockResolvedValue(null);
    await getProviderBookingDetail(UUID);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: UUID, providerId: "PROVIDER_1" } })
    );
  });

  it("returns null for a booking owned by another provider (findFirst yields nothing)", async () => {
    // Simulates provider PROVIDER_1 guessing PROVIDER_2's booking id: the
    // providerId-scoped WHERE matches no row → null (uniform not-found).
    findFirstMock.mockResolvedValue(null);
    expect(await getProviderBookingDetail(UUID, "en")).toBeNull();
  });

  it("maps an owned booking to the detail DTO", async () => {
    findFirstMock.mockResolvedValue({
      id: UUID,
      serviceId: "s1",
      status: "CONFIRMED",
      seats: 2,
      priceSnapshotAmount: "25",
      priceSnapshotCurrency: "OMR",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      service: { name: { en: "Safari" } },
      availability: { startTime: new Date("2026-06-01T09:00:00.000Z") },
    });
    const detail = await getProviderBookingDetail(UUID, "en");
    expect(detail).toMatchObject({ id: UUID, serviceId: "s1", serviceName: "Safari", status: "CONFIRMED", seats: 2 });
  });
});
