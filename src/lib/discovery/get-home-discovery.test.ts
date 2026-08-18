import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const categoryFindMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { category: { findMany: (...a: unknown[]) => categoryFindMany(...a) } } }));

const getServicesMock = vi.fn();
vi.mock("@/lib/services/get-services", () => ({ getServices: (...a: unknown[]) => getServicesMock(...a) }));

const { getHomeDiscovery } = await import("./get-home-discovery");

// A ServiceListItem-shaped row with EXTRA fields the card must NOT copy.
const row = (id: string) => ({
  id,
  name: `svc ${id}`,
  providerId: "p1",
  providerName: "Prov",
  price: "10.00",
  regionCode: "DHOFAR",
  pricingUnit: "PER_PERSON",
  coverUrl: "https://cdn/x.jpg",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  secretObjectKey: "media/x.jpg", // must never reach the card
});

beforeEach(() => {
  categoryFindMany.mockReset();
  getServicesMock.mockReset();
  // Resolve every discovery slug to a fake id.
  categoryFindMany.mockResolvedValue([
    { slug: "adventures", id: "id-adv" },
    { slug: "local-experiences", id: "id-loc" },
    { slug: "cultural-tours", id: "id-cul" },
    { slug: "tourist-guides", id: "id-tg" },
    { slug: "transfers", id: "id-tr" },
    { slug: "cars", id: "id-car" },
    { slug: "marine-trips", id: "id-mar" },
  ]);
  getServicesMock.mockResolvedValue({ items: [row("s1")], page: 1, pageSize: 6, totalCount: 1, totalPages: 1 });
});

describe("getHomeDiscovery", () => {
  it("returns the six groups mapped to their resolved category ids", async () => {
    const d = await getHomeDiscovery({ locale: "en" });
    expect(d.groups.map((g) => g.key)).toEqual([
      "EXPERIENCES",
      "TOURIST_GUIDES",
      "TRANSPORT",
      "CAR_RENTAL",
      "MARINE_TRIPS",
      "MORE",
    ]);
    // EXPERIENCES spans three ids; TOURIST_GUIDES exactly its own.
    const callArgs = getServicesMock.mock.calls.map((c) => c[0]);
    expect(callArgs.some((a) => JSON.stringify(a.categoryIds) === JSON.stringify(["id-adv", "id-loc", "id-cul"]))).toBe(true);
    expect(callArgs.some((a) => JSON.stringify(a.categoryIds) === JSON.stringify(["id-tg"]))).toBe(true);
    // MORE has no slugs -> no categoryIds filter (catch-all).
    const moreCallExists = callArgs.some((a) => a.categoryIds === undefined);
    expect(moreCallExists).toBe(true);
  });

  it("applies the governorate filter to every query when a valid region is selected", async () => {
    await getHomeDiscovery({ locale: "en", regionCode: "DHOFAR" });
    for (const call of getServicesMock.mock.calls) {
      expect(call[0].regionCode).toBe("DHOFAR");
    }
  });

  it("ALL OMAN (no/invalid region) never over-filters — no regionCode passed", async () => {
    await getHomeDiscovery({ locale: "en", regionCode: "NOT_A_REGION" });
    for (const call of getServicesMock.mock.calls) {
      expect(call[0].regionCode).toBeUndefined();
    }
    const d = await getHomeDiscovery({ locale: "en" });
    expect(d.selectedGovernorate).toBeNull();
  });

  it("enforces a small preview limit and deterministic ordering", async () => {
    await getHomeDiscovery({ locale: "en" });
    for (const call of getServicesMock.mock.calls) {
      expect(call[0].pageSize).toBe(6);
      expect(call[0].sort).toBe("newest");
    }
  });

  it("card DTO contains ONLY the allowed public fields (no objectKey/private data)", async () => {
    const d = await getHomeDiscovery({ locale: "en" });
    const card = d.groups[0]!.previewItems[0]!;
    expect(Object.keys(card).sort()).toEqual(["coverUrl", "id", "name", "price", "regionCode"]);
    expect((card as Record<string, unknown>).secretObjectKey).toBeUndefined();
    expect((card as Record<string, unknown>).providerId).toBeUndefined();
  });

  it("a group whose slugs do not resolve yields an EMPTY preview (never an unfiltered dump)", async () => {
    categoryFindMany.mockResolvedValue([]); // nothing resolves
    getServicesMock.mockClear();
    const d = await getHomeDiscovery({ locale: "en" });
    const tg = d.groups.find((g) => g.key === "TOURIST_GUIDES")!;
    expect(tg.previewItems).toEqual([]);
    // No categoryIds query was issued for an unresolved group; only MORE + recommended (2, both no categoryIds).
    expect(getServicesMock.mock.calls.every((c) => c[0].categoryIds === undefined)).toBe(true);
  });

  it("exposes governorates + destinations as code+labelKey (Explore Oman metadata only)", async () => {
    const d = await getHomeDiscovery({ locale: "en" });
    expect(d.governorates.length).toBeGreaterThan(0);
    expect(d.governorates[0]).toMatchObject({ code: expect.any(String), labelKey: expect.stringContaining("governorate.") });
    expect(d.destinations).toEqual(d.governorates);
  });
});
