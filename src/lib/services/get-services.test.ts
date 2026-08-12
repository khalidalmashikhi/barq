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

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
    provider: {
      findMany: vi.fn(),
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
});

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
