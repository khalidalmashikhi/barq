import { describe, it, expect, vi, afterEach } from "vitest";

// Marketplace Search Enhancement — regression tests for getServices().
// Covers: the new case-insensitive, multi-field, multi-word search
// (via the mocked $queryRaw), its composition with categoryKeyword and
// every other existing filter (price/provider/sort/pagination), the
// new provider-visibility gate, and the pre-existing categoryKeyword
// behavior (must remain unchanged).

vi.mock("server-only", () => ({}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();
const queryRawMock = vi.fn();
const availabilityFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
    provider: {
      findMany: vi.fn(),
    },
    // Discovery & Detail Truthfulness — getServiceSlotFacts batches over this.
    availability: {
      findMany: (...args: unknown[]) => availabilityFindManyMock(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

const { getServices } = await import("./get-services");

afterEach(() => {
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
  queryRawMock.mockReset();
  availabilityFindManyMock.mockReset();
});

// A service row shaped like the getServices include (all ACTIVE prices, ordered).
type PriceSeed = { id: string; amount: string; currency: string; pricingUnit?: string | null; createdAt: Date };
function serviceRow(id: string, prices: PriceSeed[], regionCode: string | null = null) {
  return {
    id,
    name: { en: `svc-${id}`, ar: `svc-${id}` },
    providerId: "p1",
    regionCode,
    provider: { businessName: { en: "Prov", ar: "Prov" } },
    prices,
    mediaAssets: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}
const d = (iso: string) => new Date(iso);

const PROVIDER_GATE = { status: "APPROVED", visible: true };

describe("getServices — provider visibility gate", () => {
  it("always scopes to APPROVED, visible providers, even with no other filters", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({});

    expect(queryRawMock).not.toHaveBeenCalled();
    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE },
    });
  });
});

describe("getServices — price range bug fix (found via this task's own tests)", () => {
  it("combines minPrice AND maxPrice into a single amount filter, not two colliding spreads", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ minPrice: 10, maxPrice: 50 });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE,
        prices: { some: { status: "ACTIVE", amount: { gte: 10, lte: 50 } } },
      },
    });
  });
});

describe("getServices — categoryKeyword filter (unchanged)", () => {
  it("applies categoryKeyword alone as a bilingual OR match wrapped in AND", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryKeyword: "Diving" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE,
        AND: [
          {
            OR: [
              { name: { path: ["ar"], string_contains: "Diving" } },
              { name: { path: ["en"], string_contains: "Diving" } },
            ],
          },
        ],
      },
    });
  });
});

describe("getServices — categoryId filter (B2 read path)", () => {
  it("applies categoryId as a direct relational filter (not a name-substring match)", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryId: "cat-1" });

    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE, categoryId: "cat-1" },
    });
  });

  it("does not add the legacy keyword AND-clause when only categoryId is set", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryId: "cat-1" });

    const arg = countMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty("AND");
  });

  it("Home Discovery: categoryIds matches ANY of several categories (categoryId: { in })", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryIds: ["a", "b", "c"] });

    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE, categoryId: { in: ["a", "b", "c"] } },
    });
  });

  it("categoryIds takes precedence over a single categoryId when both are passed", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryId: "single", categoryIds: ["a", "b"] });

    const arg = countMock.mock.calls[0]![0] as { where: { categoryId: unknown } };
    expect(arg.where.categoryId).toEqual({ in: ["a", "b"] });
  });

  it("an empty categoryIds array is ignored (no filter added — never an all-match dump)", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryIds: [] });

    const arg = countMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty("categoryId");
  });

  it("composes categoryId AND categoryKeyword when both are supplied (both narrow together)", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryId: "cat-1", categoryKeyword: "Diving" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE,
        categoryId: "cat-1",
        AND: [
          {
            OR: [
              { name: { path: ["ar"], string_contains: "Diving" } },
              { name: { path: ["en"], string_contains: "Diving" } },
            ],
          },
        ],
      },
    });
  });
});

describe("getServices — search (case-insensitive, multi-field, multi-word)", () => {
  it("calls $queryRaw and intersects the result via id: { in: [...] }", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([{ id: "service-1" }, { id: "service-2" }]);
    countMock.mockResolvedValue(2);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "desert" });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE,
        id: { in: ["service-1", "service-2"] },
      },
    });
  });

  it("combines search and categoryKeyword as two independent conditions, not a collision", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([{ id: "service-1" }]);
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "sunset", categoryKeyword: "Diving" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE,
        id: { in: ["service-1"] },
        AND: [
          {
            OR: [
              { name: { path: ["ar"], string_contains: "Diving" } },
              { name: { path: ["en"], string_contains: "Diving" } },
            ],
          },
        ],
      },
    });
  });

  it("treats a whitespace-only search identically to no search at all", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "   " });

    expect(queryRawMock).not.toHaveBeenCalled();
    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE },
    });
  });

  it("splits a multi-word, whitespace-collapsed query into one AND-clause per word inside the raw query", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "  desert   safari  " });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const sqlFragment = queryRawMock.mock.calls[0]?.[0] as { values: unknown[] };
    // Prisma.sql produces an object with .sql/.values — assert both
    // words appear as separate ILIKE patterns, not one combined phrase.
    expect(sqlFragment.values).toContain("%desert%");
    expect(sqlFragment.values).toContain("%safari%");
    expect(sqlFragment.values).not.toContain("%desert   safari%");
  });

  it("produces an empty result (not all results) when search matches zero services", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    const result = await getServices({ search: "xyznonexistent" });

    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE, id: { in: [] } },
    });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("preserves provider/price filters alongside search", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([{ id: "service-1" }]);
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "diving", providerId: "provider-1", minPrice: 10, maxPrice: 50 });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE,
        providerId: "provider-1",
        id: { in: ["service-1"] },
        prices: { some: { status: "ACTIVE", amount: { gte: 10, lte: 50 } } },
      },
    });
  });

  it("preserves pagination (skip/take) unchanged when searching", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([{ id: "service-1" }]);
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "diving", page: 2, pageSize: 5 });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });

  it("does not return duplicate ids even when a provider has multiple matching fields", async () => {
    // DISTINCT in the raw query is the real guarantee; this test proves
    // getServices() passes the raw result straight through without
    // introducing its own duplication.
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([{ id: "service-1" }, { id: "service-2" }]);
    countMock.mockResolvedValue(2);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "green mountain" });

    const idsPassed = (countMock.mock.calls[0]?.[0] as { where: { id: { in: string[] } } }).where.id.in;
    expect(new Set(idsPassed).size).toBe(idsPassed.length);
  });
});

describe("getServices — region + pricing unit exposure (Gate 3)", () => {
  function serviceRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "service-1",
      name: { en: "Tour", ar: "جولة" },
      providerId: "provider-1",
      provider: { businessName: { en: "Co", ar: "شركة" } },
      prices: [{ amount: "10", currency: "OMR", pricingUnit: "PER_PERSON" }],
      mediaAssets: [],
      regionCode: "DHOFAR",
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("maps regionCode (Service scalar) and pricingUnit (from the same active price row) onto each list item", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([serviceRow()]);

    const result = await getServices({});

    expect(result.items[0]!.regionCode).toBe("DHOFAR");
    expect(result.items[0]!.pricingUnit).toBe("PER_PERSON");
    expect(result.items[0]!.price).toBe("10 OMR");
  });

  it("is null-safe for legacy rows: regionCode absent and a price without pricingUnit", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([serviceRow({ regionCode: null, prices: [{ amount: "10", currency: "OMR" }] })]);

    const result = await getServices({});

    expect(result.items[0]!.regionCode).toBeNull();
    expect(result.items[0]!.pricingUnit).toBeNull();
    expect(result.items[0]!.price).toBe("10 OMR");
  });
});

describe("getServices — governorate (region) filter (Gate 4)", () => {
  const PROVIDER_GATE_LOCAL = { status: "APPROVED", visible: true };

  it("does not filter by region when none is given (existing behaviour unchanged)", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({});

    const where = (countMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty("regionCode");
  });

  it("filters by the stable regionCode when a governorate is selected", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ regionCode: "DHOFAR" });

    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE_LOCAL, regionCode: "DHOFAR" },
    });
  });

  it("composes category AND region as independent AND filters (Cars in Dhofar)", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ categoryId: "cars-cat", regionCode: "DHOFAR" });

    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", provider: PROVIDER_GATE_LOCAL, categoryId: "cars-cat", regionCode: "DHOFAR" },
    });
  });

  it("keeps the provider-visibility gate and search intersection alongside a region filter", async () => {
    getLocaleMock.mockResolvedValue("en");
    queryRawMock.mockResolvedValue([{ id: "service-1" }]);
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([]);

    await getServices({ search: "sunset", regionCode: "MUSCAT" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        provider: PROVIDER_GATE_LOCAL,
        id: { in: ["service-1"] },
        regionCode: "MUSCAT",
      },
    });
  });
});

// DISCOVERY & DETAIL TRUTHFULNESS — deterministic headline min price + shared bookability.
const S1 = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const S2 = "019f4e4e-80b8-7cf2-b043-916c71648fcb";

describe("getServices — headline price (deterministic minimum)", () => {
  it("shows the MIN active price and marks it 'from' when there is more than one", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    availabilityFindManyMock.mockResolvedValue([]); // not slot-based
    findManyMock.mockResolvedValue([
      serviceRow(S1, [
        { id: "pr1", amount: "40", currency: "OMR", pricingUnit: "PER_DAY", createdAt: d("2026-01-01") },
        { id: "pr2", amount: "15", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: d("2026-01-02") },
      ]),
    ]);

    const { items } = await getServices({});
    expect(items[0]!.price).toBe("15 OMR");
    expect(items[0]!.priceIsFrom).toBe(true);
    expect(items[0]!.pricingUnit).toBe("PER_PERSON"); // unit of the MIN row
  });

  it("a single active price is shown bare (never 'from')", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    availabilityFindManyMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([
      serviceRow(S1, [{ id: "pr1", amount: "25", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: d("2026-01-01") }]),
    ]);

    const { items } = await getServices({});
    expect(items[0]!.price).toBe("25 OMR");
    expect(items[0]!.priceIsFrom).toBe(false);
  });

  it("price sort is keyed on the deterministic minimum (not an arbitrary row)", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(2);
    availabilityFindManyMock.mockResolvedValue([]);
    // S1's min is 40, S2's min is 15 — ascending must place S2 first regardless of row order.
    findManyMock.mockResolvedValue([
      serviceRow(S1, [{ id: "a", amount: "40", currency: "OMR", createdAt: d("2026-01-01") }]),
      serviceRow(S2, [{ id: "b", amount: "15", currency: "OMR", createdAt: d("2026-01-01") }]),
    ]);

    const { items } = await getServices({ sort: "price_asc" });
    expect(items.map((i) => i.id)).toEqual([S2, S1]);
  });
});

describe("getServices — bookability projection", () => {
  it("BOOKABLE_NOW for a slot-based service with a free future slot", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([serviceRow(S1, [{ id: "pr1", amount: "25", currency: "OMR", createdAt: d("2026-01-01") }])]);
    availabilityFindManyMock
      .mockResolvedValueOnce([{ serviceId: S1 }]) // declared → slot-based
      .mockResolvedValueOnce([{ serviceId: S1, capacity: 5, bookedCount: 1 }]); // a free seat

    const { items } = await getServices({});
    expect(items[0]!.bookability).toBe("BOOKABLE_NOW");
  });

  it("NO_CURRENT_AVAILABILITY for a slot-based service whose only future slot is full", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([serviceRow(S1, [{ id: "pr1", amount: "25", currency: "OMR", createdAt: d("2026-01-01") }])]);
    availabilityFindManyMock
      .mockResolvedValueOnce([{ serviceId: S1 }])
      .mockResolvedValueOnce([{ serviceId: S1, capacity: 4, bookedCount: 4 }]);

    const { items } = await getServices({});
    expect(items[0]!.bookability).toBe("NO_CURRENT_AVAILABILITY");
  });

  it("SLOTLESS_BOOKABLE for a priced service with no declared availability", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([serviceRow(S1, [{ id: "pr1", amount: "25", currency: "OMR", createdAt: d("2026-01-01") }])]);
    availabilityFindManyMock.mockResolvedValue([]);

    const { items } = await getServices({});
    expect(items[0]!.bookability).toBe("SLOTLESS_BOOKABLE");
  });

  it("UNAVAILABLE for a service with no active price", async () => {
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([serviceRow(S1, [])]);
    availabilityFindManyMock.mockResolvedValue([]);

    const { items } = await getServices({});
    expect(items[0]!.price).toBeNull();
    expect(items[0]!.bookability).toBe("UNAVAILABLE");
  });
});
