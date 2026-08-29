import { describe, it, expect, vi, afterEach } from "vitest";

// Production Blocker fix — regression tests proving getServiceById() now
// scopes on Provider.status/visible, mirroring get-services.ts's own
// "NO PROVIDER-VISIBILITY GATE, FOUND AND FIXED" precedent. Before this
// fix, a service published while its provider was APPROVED remained
// fully reachable (and bookable, via services/[id]/book) even after that
// provider was later archived (DEACTIVATED) — a real gap this test
// guards against regressing.

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();
const serviceFindManyMock = vi.fn();

const priceFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      findMany: (...args: unknown[]) => serviceFindManyMock(...args),
    },
    price: {
      findMany: (...args: unknown[]) => priceFindManyMock(...args),
    },
  },
}));

// BOOKING-PRICE-SEMANTICS — getServerTranslator is a deliberately thin pass-through to
// next-intl's getTranslations, which needs a request context vitest has no reason to build.
// So the seam is stubbed HERE, at next-intl, and backed by the REAL messages/<locale>/
// common.json catalogs rather than a hand-written map: a test that invented its own label
// strings would still pass if the catalog entry were deleted. It also records WHICH locale
// the producer asked for, the only behavioural difference between the API path (an explicit
// locale) and the Web path (the ambient request locale).
let requestedLocale: string | null = null;
let usedExplicitLocale = false;

vi.mock("next-intl/server", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  return {
    getLocale: vi.fn().mockResolvedValue("en"),
    getTranslations: async (arg: unknown) => {
      const explicit = typeof arg === "object" && arg !== null;
      const locale = explicit ? (arg as { locale: string }).locale : "en";
      const namespace = explicit ? (arg as { namespace?: string }).namespace : (arg as string);
      usedExplicitLocale = explicit;
      requestedLocale = locale;

      const catalog = JSON.parse(
        readFileSync(join(process.cwd(), "messages", locale, namespace + ".json"), "utf-8")
      ) as Record<string, unknown>;

      return (key: string) =>
        key.split(".").reduce<unknown>(
          (node, part) =>
            typeof node === "object" && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          catalog
        ) as string;
    },
  };
});

const { getServiceById, getActivePricesForService, getRelatedServices } = await import("./get-service-detail");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  findFirstMock.mockReset();
  serviceFindManyMock.mockReset();
  priceFindManyMock.mockReset();
  requestedLocale = null;
  usedExplicitLocale = false;
});

describe("getServiceById", () => {
  it("queries with the provider APPROVED+visible gate, not just Service.status", async () => {
    findFirstMock.mockResolvedValue(null);

    await getServiceById(SERVICE_ID);

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SERVICE_ID, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
      })
    );
  });

  it("returns null for a service whose provider has since been deactivated — the exact scenario this fix closes", async () => {
    // A real deactivated-provider service is simply never returned by
    // the (now-guarded) query — simulated here by the mock resolving
    // null, exactly what the guarded `where` clause would produce
    // against a real database.
    findFirstMock.mockResolvedValue(null);

    const result = await getServiceById(SERVICE_ID);

    expect(result).toBeNull();
  });

  it("returns null for an invalid id without querying the database", async () => {
    const result = await getServiceById("not-a-uuid");

    expect(result).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  // Core Service Enrichment, Gate 3 — the detail read model exposes regionCode
  // (Service scalar) and pricingUnit (from the SAME ACTIVE price row as amount).
  describe("region + pricing unit exposure (Gate 3)", () => {
    function row(overrides: Record<string, unknown> = {}) {
      return {
        id: SERVICE_ID,
        name: { en: "Tour", ar: "جولة" },
        description: null,
        providerId: "provider-1",
        provider: { businessName: { en: "Co", ar: "شركة" }, businessDescription: null, status: "APPROVED" },
        prices: [{ amount: "10", currency: "OMR", pricingUnit: "PER_PERSON" }],
        mediaAssets: [],
        regionCode: "DHOFAR",
        createdAt: new Date(),
        ...overrides,
      };
    }

    it("returns regionCode and pricingUnit from the same active price row", async () => {
      findFirstMock.mockResolvedValue(row());

      const result = await getServiceById(SERVICE_ID);

      expect(result?.regionCode).toBe("DHOFAR");
      expect(result?.pricingUnit).toBe("PER_PERSON");
      expect(result?.price).toBe("10 OMR");
    });

    it("is null-safe for legacy rows: regionCode absent and price without a pricingUnit", async () => {
      findFirstMock.mockResolvedValue(row({ regionCode: null, prices: [{ amount: "10", currency: "OMR" }] }));

      const result = await getServiceById(SERVICE_ID);

      expect(result?.regionCode).toBeNull();
      expect(result?.pricingUnit).toBeNull();
      expect(result?.price).toBe("10 OMR");
    });

    it("keeps pricingUnit null when there is no active price at all", async () => {
      findFirstMock.mockResolvedValue(row({ prices: [] }));

      const result = await getServiceById(SERVICE_ID);

      expect(result?.pricingUnit).toBeNull();
      expect(result?.price).toBeNull();
    });

    // DISCOVERY & DETAIL TRUTHFULNESS — the detail headline is the deterministic MINIMUM.
    it("shows the minimum active price as the headline and marks it 'from'", async () => {
      findFirstMock.mockResolvedValue(
        row({
          prices: [
            { id: "a", amount: "40", currency: "OMR", pricingUnit: "PER_DAY", createdAt: new Date("2026-01-01") },
            { id: "b", amount: "15", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: new Date("2026-01-02") },
          ],
        })
      );

      const result = await getServiceById(SERVICE_ID);

      expect(result?.price).toBe("15 OMR");
      expect(result?.priceIsFrom).toBe(true);
      expect(result?.pricingUnit).toBe("PER_PERSON");
    });
  });
});

// DISCOVERY & DETAIL TRUTHFULNESS — related services must apply the same provider gate.
describe("getRelatedServices", () => {
  it("scopes to PUBLISHED services from APPROVED, visible providers (same gate as the listing)", async () => {
    serviceFindManyMock.mockResolvedValue([]);

    await getRelatedServices(SERVICE_ID, "provider-1");

    expect(serviceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "PUBLISHED",
          provider: { status: "APPROVED", visible: true },
          providerId: "provider-1",
          id: { not: SERVICE_ID },
        },
      })
    );
  });

  it("maps the headline minimum price + priceIsFrom for each related service", async () => {
    serviceFindManyMock.mockResolvedValue([
      {
        id: "rel-1",
        name: { en: "Rel", ar: "قريب" },
        provider: { businessName: { en: "Co", ar: "شركة" } },
        prices: [
          { id: "a", amount: "30", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: new Date("2026-01-01") },
          { id: "b", amount: "12", currency: "OMR", pricingUnit: "PER_PERSON", createdAt: new Date("2026-01-02") },
        ],
        mediaAssets: [],
      },
    ]);

    const [related] = await getRelatedServices(SERVICE_ID, "provider-1");

    expect(related!.price).toBe("12 OMR");
    expect(related!.priceIsFrom).toBe(true);
  });
});

// BOOKING-PRICE-SEMANTICS — a service may publish several ACTIVE prices at once. Before
// this gate they reached every client as bare amounts with no stated basis: 25 OMR and
// 40.5 OMR are distinguishable as numbers but are not a CHOICE a customer can reason
// about, because nothing said one was per person and the other per day.
describe("getActivePricesForService — per-option pricing unit", () => {
  function priceRow(over: Record<string, unknown> = {}) {
    return { id: "pr1", amount: "25", currency: "OMR", pricingUnit: "PER_PERSON", ...over };
  }

  it("preserves id, amount and currency exactly as before", async () => {
    priceFindManyMock.mockResolvedValue([priceRow()]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(only!.id).toBe("pr1");
    expect(only!.amount).toBe("25");
    expect(only!.currency).toBe("OMR");
  });

  it("carries the stable unit code alongside a label resolved from the real catalog", async () => {
    priceFindManyMock.mockResolvedValue([priceRow()]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(only!.pricingUnit).toBe("PER_PERSON");
    expect(only!.pricingUnitLabel).toBe("per person");
  });

  /** THE CASE THE WHOLE GATE EXISTS FOR. */
  it("gives two active prices their own distinct units and labels", async () => {
    priceFindManyMock.mockResolvedValue([
      priceRow({ id: "pr1", amount: "25", pricingUnit: "PER_PERSON" }),
      priceRow({ id: "pr2", amount: "40.5", pricingUnit: "PER_DAY" }),
    ]);

    const options = await getActivePricesForService(SERVICE_ID);

    expect(options.map((o) => o.pricingUnit)).toEqual(["PER_PERSON", "PER_DAY"]);
    expect(options.map((o) => o.pricingUnitLabel)).toEqual(["per person", "per day"]);
  });

  // --- localization is the PLATFORM's job, never a client's ------------------

  it("resolves the label in Arabic when the caller asks for Arabic", async () => {
    priceFindManyMock.mockResolvedValue([priceRow()]);

    const [only] = await getActivePricesForService(SERVICE_ID, "ar");

    expect(usedExplicitLocale).toBe(true);
    expect(requestedLocale).toBe("ar");
    expect(only!.pricingUnit).toBe("PER_PERSON"); // the CODE never localizes
    expect(only!.pricingUnitLabel).toBe("\u0644\u0644\u0634\u062e\u0635");
    expect(only!.pricingUnitLabel).not.toBe("per person");
  });

  it("falls back to the request locale when no override is given", async () => {
    priceFindManyMock.mockResolvedValue([priceRow()]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(usedExplicitLocale).toBe(false);
    expect(only!.pricingUnitLabel).toBe("per person");
  });

  // --- fail-safe ------------------------------------------------------------

  /** A legacy flat price has no unit, and must not acquire an invented one. */
  it("reports null unit and null label for a legacy price", async () => {
    priceFindManyMock.mockResolvedValue([priceRow({ pricingUnit: null })]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(only!.pricingUnit).toBeNull();
    expect(only!.pricingUnitLabel).toBeNull();
    expect(only!.amount).toBe("25"); // the price itself is still shown
  });

  it("treats an absent pricingUnit column the same as null", async () => {
    priceFindManyMock.mockResolvedValue([{ id: "pr1", amount: "25", currency: "OMR" }]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(only!.pricingUnit).toBeNull();
    expect(only!.pricingUnitLabel).toBeNull();
  });

  /**
   * A FUTURE UNIT MUST NOT LEAK AS A LABEL. The vocabulary is a code registry with no DB
   * CHECK behind it, so a row can legitimately hold a code this build does not govern yet.
   * It keeps its stable value on the wire — a client may branch on it — but resolves to NO
   * label, so a raw SCREAMING_CASE code can never surface at a customer.
   */
  it("keeps an ungoverned future unit but refuses to label it", async () => {
    priceFindManyMock.mockResolvedValue([priceRow({ pricingUnit: "PER_NIGHT" })]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(only!.pricingUnit).toBe("PER_NIGHT");
    expect(only!.pricingUnitLabel).toBeNull();
  });

  it("never emits the raw code as its own label", async () => {
    priceFindManyMock.mockResolvedValue([
      priceRow({ id: "a", pricingUnit: "PER_TRIP" }),
      priceRow({ id: "b", pricingUnit: "TOTALLY_NEW" }),
    ]);

    for (const option of await getActivePricesForService(SERVICE_ID)) {
      expect(option.pricingUnitLabel).not.toBe(option.pricingUnit);
    }
  });

  // --- behaviour this gate must NOT have changed ----------------------------

  it("still queries only ACTIVE prices, newest first", async () => {
    priceFindManyMock.mockResolvedValue([]);

    await getActivePricesForService(SERVICE_ID);

    expect(priceFindManyMock).toHaveBeenCalledWith({
      where: { serviceId: SERVICE_ID, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("preserves the server ordering rather than re-sorting", async () => {
    priceFindManyMock.mockResolvedValue([priceRow({ id: "newest" }), priceRow({ id: "older" })]);

    const ids = (await getActivePricesForService(SERVICE_ID)).map((o) => o.id);

    expect(ids).toEqual(["newest", "older"]);
  });

  it("returns an empty list for an invalid id without querying", async () => {
    expect(await getActivePricesForService("not-a-uuid")).toEqual([]);
    expect(priceFindManyMock).not.toHaveBeenCalled();
  });

  /** An allow-list: no internal Price column rides along. */
  it("exposes only the five contract fields", async () => {
    priceFindManyMock.mockResolvedValue([
      {
        id: "pr1",
        amount: "25",
        currency: "OMR",
        pricingUnit: "PER_PERSON",
        status: "ACTIVE",
        serviceId: SERVICE_ID,
      },
    ]);

    const [only] = await getActivePricesForService(SERVICE_ID);

    expect(Object.keys(only!).sort()).toEqual([
      "amount",
      "currency",
      "id",
      "pricingUnit",
      "pricingUnitLabel",
    ]);
  });
});
