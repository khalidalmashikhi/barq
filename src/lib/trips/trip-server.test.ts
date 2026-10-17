import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-10-17 — Trip planner, grounded foundation: the server side (candidate read, generation
// service, read-only revalidation, the /api/v1 adapters, client-bundle isolation). Prisma and the
// public reads are mocked; any outbound request fails the test.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({ withRequestTracing: (_n: string, h: () => unknown) => h() }));
const logs: { level: string; message: string; context: unknown }[] = [];
vi.mock("@/lib/logger", () => ({
  logger: {
    info: (message: string, context: unknown) => logs.push({ level: "info", message, context }),
    warn: (message: string, context: unknown) => logs.push({ level: "warn", message, context }),
    error: (message: string, context: unknown) => logs.push({ level: "error", message, context }),
  },
}));
const serviceFindMany = vi.fn();
const availabilityFindMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { service: { findMany: (...a: unknown[]) => serviceFindMany(...a) }, availability: { findMany: (...a: unknown[]) => availabilityFindMany(...a) } } }));
const slotFacts = vi.fn();
vi.mock("@/lib/services/bookability-facts", () => ({ getServiceSlotFacts: (...a: unknown[]) => slotFacts(...a) }));
const getServiceById = vi.fn();
const getActivePrices = vi.fn();
vi.mock("@/lib/services/get-service-detail", () => ({ getServiceById: (...a: unknown[]) => getServiceById(...a), getActivePricesForService: (...a: unknown[]) => getActivePrices(...a) }));
const availableSlots = vi.fn();
vi.mock("@/lib/booking/get-available-slots", () => ({ getAvailableSlots: (...a: unknown[]) => availableSlots(...a) }));
const requiresSlot = vi.fn();
vi.mock("@/lib/booking/service-requires-slot", () => ({ serviceRequiresSlot: (...a: unknown[]) => requiresSlot(...a) }));

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
vi.stubGlobal("fetch", fetchGuard);

const { getTripCandidates, TRIP_PUBLIC_SERVICE_GATE } = await import("./trip-candidates");
const { generateTripPlan, TRIP_PLAN_RATE_LIMIT } = await import("./generate-trip-plan");
const { getTripPlannerModel, TRIP_PLANNER_AI_CONFIG } = await import("./trip-planner-model");
const { revalidateTripItems } = await import("./revalidate-trip-items");
const planRoute = await import("@/app/api/v1/trips/plan/route");
const revalidateRoute = await import("@/app/api/v1/trips/revalidate/route");

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const dec = (v: string) => ({ toFixed: (n: number) => Number(v).toFixed(n), toString: () => v });
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const row = (id: string, over: Record<string, unknown> = {}) => ({ id, name: { ar: "خدمة تجريبية", en: "Synthetic service" }, regionCode: "MUSCAT", durationMinutes: 120, category: { slug: "adventures" }, prices: [{ amount: dec("10"), currency: "OMR", pricingUnit: "PER_PERSON" }], ...over });

let n = 0;
beforeEach(() => {
  logs.length = 0;
  serviceFindMany.mockReset().mockResolvedValue([row(ID1), row(ID2, { prices: [{ amount: dec("30"), currency: "OMR", pricingUnit: "PER_DAY" }] })]);
  availabilityFindMany.mockReset().mockResolvedValue([]);
  slotFacts.mockReset().mockResolvedValue({ requiresSlot: new Set(), hasBookableSlot: new Set() });
  getServiceById.mockReset();
  getActivePrices.mockReset();
  availableSlots.mockReset().mockResolvedValue([]);
  requiresSlot.mockReset().mockResolvedValue(false);
  n += 1;
});
afterEach(() => expect(fetchGuard).not.toHaveBeenCalled());

describe("candidate read — public gate, region, bookable prices, the smallest dataset", () => {
  it("queries only PUBLISHED services of APPROVED + VISIBLE providers in the region with an ACTIVE price", async () => {
    await getTripCandidates({ regionCode: "MUSCAT", dateKeys: [null], locale: "en" });
    const arg = serviceFindMany.mock.calls[0]![0] as { where: Record<string, unknown>; select: Record<string, unknown>; take: number };
    expect(arg.where).toMatchObject({ status: "PUBLISHED", provider: { status: "APPROVED", visible: true }, regionCode: "MUSCAT", prices: { some: { status: "ACTIVE" } } });
    expect(arg.take).toBeLessThanOrEqual(40);
    // the SAME hard gate as the public service list
    expect(read("src/lib/services/get-services.ts")).toMatch(/status: "PUBLISHED" as const,[\s\S]{0,200}provider: \{ status: "APPROVED" as const, visible: true \}/);
    expect(TRIP_PUBLIC_SERVICE_GATE).toEqual({ status: "PUBLISHED", provider: { status: "APPROVED", visible: true } });
  });

  it("selects no provider, description, document, vehicle or registration data", async () => {
    await getTripCandidates({ regionCode: "MUSCAT", dateKeys: [null], locale: "en" });
    const select = (serviceFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(Object.keys(select).sort()).toEqual(["category", "durationMinutes", "id", "name", "prices", "regionCode"]);
    expect(JSON.stringify(select)).not.toMatch(/provider|description|document|vehicle|registration|phone|email|plate|vin/i);
  });

  it("drops non-bookable price units (and services left without one); groups open slots by Oman date with seats left", async () => {
    slotFacts.mockResolvedValue({ requiresSlot: new Set([ID1]), hasBookableSlot: new Set([ID1]) });
    availabilityFindMany.mockResolvedValue([
      { serviceId: ID1, startTime: new Date("2026-11-01T05:00:00Z"), capacity: 6, bookedCount: 2 }, // 09:00 Muscat
      { serviceId: ID1, startTime: new Date("2026-11-01T14:00:00Z"), capacity: 4, bookedCount: 4 }, // full
    ]);
    const out = await getTripCandidates({ regionCode: "MUSCAT", dateKeys: ["2026-11-01"], locale: "en" });
    expect(out.map((c) => c.serviceId)).toEqual([ID1]); // ID2 only has PER_DAY → not bookable
    expect(out[0]).toMatchObject({ name: "Synthetic service", categorySlug: "adventures", requiresSlot: true, slotsByDate: { "2026-11-01": [{ startHour: 9, remainingSeats: 4 }] } });
    expect(out[0]!.prices).toEqual([{ amount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON" }]);
  });
});

describe("generation service — stateless, deterministic, rate-limited, fail-closed model boundary", () => {
  const key = () => `test-requester-${n}`;

  it("minimum input → a plan; no model is configured and none is called", async () => {
    const r = await generateTripPlan({ input: { regionCode: "MUSCAT", days: 2 }, locale: "en", requesterKey: key() });
    expect(r.ok && "plan" in r && r.plan.days.length).toBe(2);
    expect(getTripPlannerModel()).toBeNull();
    expect(TRIP_PLANNER_AI_CONFIG).not.toContain("ANTHROPIC_API_KEY"); // never the OCR credential
    const code = read("src/lib/trips/trip-planner-model.ts").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/process\.env|fetch\(|api\.anthropic|ANTHROPIC/); // no key read, no call, no provider in this phase
  });

  it("invalid input and an out-of-range day are rejected before any read", async () => {
    expect(await generateTripPlan({ input: { regionCode: "MUSCAT" }, locale: "en", requesterKey: key() })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await generateTripPlan({ input: { regionCode: "MUSCAT", days: 2 }, locale: "en", requesterKey: key(), regenerateDay: 5 })).toMatchObject({ ok: false, code: "INVALID_INPUT", fields: ["regenerateDay"] });
    expect(serviceFindMany).not.toHaveBeenCalled();
  });

  it("repeated requests give the same plan; the per-requester limit then answers RATE_LIMITED", async () => {
    const k = key();
    const a = await generateTripPlan({ input: { regionCode: "MUSCAT", days: 2 }, locale: "en", requesterKey: k });
    const b = await generateTripPlan({ input: { regionCode: "MUSCAT", days: 2 }, locale: "en", requesterKey: k });
    expect(a).toEqual(b);
    for (let i = 2; i < TRIP_PLAN_RATE_LIMIT.limit; i++) await generateTripPlan({ input: { regionCode: "MUSCAT", days: 1 }, locale: "en", requesterKey: k });
    expect(await generateTripPlan({ input: { regionCode: "MUSCAT", days: 1 }, locale: "en", requesterKey: k })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("a failing read is FAILED_RETRYABLE; logs carry outcome categories, counts and timings only", async () => {
    serviceFindMany.mockRejectedValueOnce(new Error("db down"));
    expect(await generateTripPlan({ input: { regionCode: "MUSCAT", days: 1, interests: ["family"], adults: 3, startDate: "2027-01-05" }, locale: "en", requesterKey: key() })).toEqual({ ok: false, code: "FAILED_RETRYABLE" });
    await generateTripPlan({ input: { regionCode: "MUSCAT", days: 1, interests: ["family"], adults: 3, startDate: "2027-01-05" }, locale: "en", requesterKey: key() });
    for (const l of logs) {
      expect(Object.keys(l.context as object).sort().join(",")).toMatch(/^(barqItems,)?candidateCount,days,durationMs,outcome(,source)?$|^durationMs,outcome$/);
      expect(JSON.stringify(l)).not.toMatch(/MUSCAT|family|2027-01-05|adults|test-requester/);
    }
  });

  it("regenerating one day keeps the other days' services out of it", async () => {
    const r = await generateTripPlan({ input: { regionCode: "MUSCAT", days: 2, pace: "relaxed" }, locale: "en", requesterKey: key(), regenerateDay: 2, keepServiceIds: [ID1] });
    expect(r.ok && "day" in r).toBe(true);
    if (r.ok && "day" in r) expect(JSON.stringify(r.day)).not.toContain(ID1);
  });
});

describe("revalidation — read-only re-check of price, slot and seats before booking", () => {
  const item = (over: Record<string, unknown> = {}) => ({ serviceId: ID1, date: "2026-11-01", expectedCost: { min: "20.00", max: "20.00", currency: "OMR" }, ...over });
  beforeEach(() => {
    getServiceById.mockResolvedValue({ name: "Synthetic", info: { durationMinutes: 60 } });
    getActivePrices.mockResolvedValue([{ id: "p", amount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON", pricingUnitLabel: null }]);
  });

  it("OK when the price and a slot with enough seats still exist", async () => {
    requiresSlot.mockResolvedValue(true);
    availableSlots.mockResolvedValue([{ id: "s", startTime: new Date("2026-11-01T06:00:00Z"), endTime: new Date(), remainingSeats: 3 }]);
    expect(await revalidateTripItems({ adults: 2, children: 0, items: [item()] }, "en")).toMatchObject({ ok: true, items: [{ status: "OK", availability: "AVAILABLE_ON_DATE" }] });
  });

  it("PRICE_CHANGED, NO_SLOT_ON_DATE (incl. too few seats) and NO_LONGER_AVAILABLE are reported", async () => {
    getActivePrices.mockResolvedValueOnce([{ id: "p", amount: "12.00", currency: "OMR", pricingUnit: "PER_PERSON", pricingUnitLabel: null }]);
    expect(await revalidateTripItems({ adults: 2, children: 0, items: [item()] }, "en")).toMatchObject({ ok: true, items: [{ status: "PRICE_CHANGED", currentCost: { min: "24.00" } }] });
    requiresSlot.mockResolvedValue(true);
    availableSlots.mockResolvedValue([{ id: "s", startTime: new Date("2026-11-01T06:00:00Z"), endTime: new Date(), remainingSeats: 1 }]);
    expect(await revalidateTripItems({ adults: 2, children: 0, items: [item()] }, "en")).toMatchObject({ ok: true, items: [{ status: "NO_SLOT_ON_DATE" }] });
    getServiceById.mockResolvedValueOnce(null);
    expect(await revalidateTripItems({ adults: 2, children: 0, items: [item()] }, "en")).toMatchObject({ ok: true, items: [{ status: "NO_LONGER_AVAILABLE" }] });
  });

  it("rejects malformed requests (bad id, bad date, too many items, unknown keys) without reading anything", async () => {
    for (const bad of [
      { adults: 2, children: 0, items: [item({ serviceId: "x" })] },
      { adults: 2, children: 0, items: [item({ date: "01/11/2026" })] },
      { adults: 2, children: 0, items: Array.from({ length: 22 }, () => item()) },
      { adults: 2, children: 0, items: [item()], phone: "+968" },
    ]) {
      expect(await revalidateTripItems(bad, "en")).toEqual({ ok: false, code: "INVALID_INPUT" });
    }
    expect(getServiceById).not.toHaveBeenCalled();
  });
});

describe("/api/v1/trips adapters", () => {
  const post = (url: string, body: unknown, ip = `10.0.0.${n}`) => new Request(`http://localhost${url}?locale=en`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) });

  it("POST /trips/plan → 200 { plan } with no-store; invalid → 400 INVALID_INPUT with the fields", async () => {
    const ok = await planRoute.POST(post("/api/v1/trips/plan", { input: { regionCode: "MUSCAT", days: 1 } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect((await ok.json()).plan.days).toHaveLength(1);
    const bad = await planRoute.POST(post("/api/v1/trips/plan", { input: { regionCode: "MUSCAT", days: 99 } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatchObject({ code: "INVALID_INPUT", details: { fields: ["days"] } });
  });

  it("POST /trips/revalidate → 200 { items } or 400", async () => {
    getServiceById.mockResolvedValue(null);
    const ok = await revalidateRoute.POST(post("/api/v1/trips/revalidate", { adults: 1, children: 0, items: [{ serviceId: ID1, date: null, expectedCost: null }] }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).items[0].status).toBe("NO_LONGER_AVAILABLE");
    expect((await revalidateRoute.POST(post("/api/v1/trips/revalidate", { items: [] }))).status).toBe(400);
  });

  it("the routes store nothing and read no plan by id (no cross-user access is possible)", () => {
    for (const rel of ["src/app/api/v1/trips/plan/route.ts", "src/lib/trips/generate-trip-plan.ts", "src/lib/trips/revalidate-trip-items.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\.create\(|\.update\(|\.upsert\(|\.delete\(|planId|tripPlan\.find/);
    }
  });
});

describe("client isolation — no server code, key, prompt or schema reaches the browser", () => {
  const CLIENT = read("src/app/[locale]/trips/_components/trip-planner.tsx");
  it("the island imports only client-safe modules", () => {
    const imports = [...CLIENT.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
    expect(imports).not.toEqual(expect.arrayContaining(["@/lib/trips/trip-planner"]));
    for (const i of imports) expect(i, i).not.toMatch(/trip-planner$|trip-candidates|generate-trip-plan|trip-planner-model|trip-model-contract|revalidate-trip-items|@\/lib\/db|@prisma|server-only|calculate-booking-total/);
    for (const rel of ["src/lib/trips/trip-input.ts", "src/lib/trips/trip-plan.ts", "src/lib/trips/trip-plan-editing.ts"]) expect(read(rel), rel).not.toMatch(/server-only|@\/lib\/db|@prisma|process\.env/);
    for (const rel of ["src/lib/trips/trip-candidates.ts", "src/lib/trips/generate-trip-plan.ts", "src/lib/trips/trip-planner-model.ts", "src/lib/trips/revalidate-trip-items.ts"]) expect(read(rel), rel).toMatch(/^import "server-only";/);
  });

  it("one request at a time, stale answers dropped, nothing stored; 'continue to booking' revalidates first", () => {
    expect(CLIENT).toMatch(/if \(inFlight\.current\) return;/);
    expect(CLIENT).toMatch(/isCurrentResponse\(seq, latestSeq\.current/);
    expect(CLIENT).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    const book = CLIENT.slice(CLIENT.indexOf("const continueToBooking"), CLIENT.indexOf("const money"));
    expect(book.indexOf('"/api/v1/trips/revalidate"')).toBeGreaterThan(-1);
    expect(book.indexOf('"/api/v1/trips/revalidate"')).toBeLessThan(book.indexOf("router.push"));
    expect(book).toMatch(/if \(result\.status === "OK"\)/);
    // a general suggestion never offers booking
    const general = CLIENT.slice(CLIENT.indexOf('if (item.kind === "GENERAL_SUGGESTION")'), CLIENT.indexOf("const confirmed"));
    expect(general).not.toMatch(/onBook|continueToBooking|\/services\//);
  });
});
