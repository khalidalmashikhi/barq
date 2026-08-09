import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System (provider) — getProviderPublishedServicesForPreview():
// PUBLISHED-only, provider-scoped, WITHOUT the provider APPROVED+visible gate.
// Never returns DRAFT/PAUSED/ARCHIVED; does not touch public getServices.

vi.mock("server-only", () => ({}));

const countMock = vi.fn();
const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      count: (...a: unknown[]) => countMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
    },
  },
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

const { getProviderPublishedServicesForPreview } = await import("./get-provider-services-for-preview");

afterEach(() => {
  countMock.mockReset();
  findManyMock.mockReset();
});

describe("getProviderPublishedServicesForPreview", () => {
  it("queries providerId + status PUBLISHED only, with NO provider-visibility gate", async () => {
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getProviderPublishedServicesForPreview("prov-1", 1);

    const whereCount = (countMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    const whereFind = (findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(whereCount).toEqual({ providerId: "prov-1", status: "PUBLISHED" });
    expect(whereFind).toEqual({ providerId: "prov-1", status: "PUBLISHED" });
    // No provider APPROVED/visible sub-filter (that gate belongs to getServices only).
    expect(whereFind.provider).toBeUndefined();
  });

  it("maps rows to ServiceListItem shape incl. cover, and returns empty for a provider with no published services", async () => {
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);
    const empty = await getProviderPublishedServicesForPreview("prov-1");
    expect(empty.items).toEqual([]);
    expect(empty.page).toBe(1);
    expect(empty.totalPages).toBe(1);

    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "svc-1",
        name: { en: "Trek", ar: "" },
        providerId: "prov-1",
        provider: { businessName: { en: "Acme", ar: "" } },
        prices: [{ amount: 25, currency: "OMR" }],
        mediaAssets: [{ url: "https://x/c.jpg" }],
        createdAt: new Date(),
      },
    ]);
    const result = await getProviderPublishedServicesForPreview("prov-1");
    expect(result.items[0]).toMatchObject({
      id: "svc-1",
      name: "Trek",
      providerName: "Acme",
      price: "25 OMR",
      coverUrl: "https://x/c.jpg",
    });
  });
});
