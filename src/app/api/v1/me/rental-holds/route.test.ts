import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({ withRequestTracing: (_n: string, h: () => Promise<Response>) => h() }));
// Authenticated wrapper: invoke the handler with a locale (auth itself is tested elsewhere).
vi.mock("@/lib/api/v1/auth", () => ({ withApiV1Auth: (_req: Request, h: (c: { locale: string }) => Promise<Response>) => h({ locale: "en" }) }));

const acquire = vi.fn();
const release = vi.fn();
const confirm = vi.fn();
vi.mock("@/lib/offerings/rental/booking/customer-rental-hold-actions", () => ({
  acquireRentalHoldForCustomer: (...a: unknown[]) => acquire(...a),
  releaseRentalHoldForCustomer: (...a: unknown[]) => release(...a),
  confirmRentalHoldForCustomer: (...a: unknown[]) => confirm(...a),
  parseExpectedQuoteInput: (raw: unknown) => (raw && typeof raw === "object" ? raw : null),
}));

const { POST: ACQUIRE } = await import("./route");
const { DELETE: RELEASE } = await import("./[holdId]/route");
const { POST: CONFIRM } = await import("./[holdId]/confirm/route");

const holdDTO = { holdId: "h1", holdToken: "tok", status: "HELD", expiresAt: "2030-07-01T08:10:00.000Z", serviceId: "s1", offeringId: "o1", vehicleId: "v1", passengerCount: 2, dateKeys: ["2030-07-10"], perDate: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", source: "BASE" }], total: "40.00", currency: "OMR", quoteFingerprint: "fp", replayed: false };
const quote = { offeringId: "o1", vehicleId: "v1", serviceId: "s1", currency: "OMR", dateKeys: ["2030-07-10"], days: [{ dateKey: "2030-07-10", amount: "50.00", currency: "OMR", priceSource: "BASE" }], chargeableDays: 1, total: "50.00", lowestDailyRate: "50.00", quoteFingerprint: "fp2" };

const req = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/v1/me/rental-holds", { method: "POST", body: JSON.stringify(body), headers });
const params = (holdId: string) => ({ params: Promise.resolve({ holdId }) });

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/v1/me/rental-holds (acquire)", () => {
  it("201 with the safe hold on a fresh acquisition; forwards the Idempotency-Key header", async () => {
    acquire.mockResolvedValue({ ok: true, hold: holdDTO });
    const res = await ACQUIRE(req({ offeringId: "o1", dateKeys: ["2030-07-10"], passengerCount: 2 }, { "Idempotency-Key": "k-1" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "k-1", offeringId: "o1" }));
    expect(await res.json()).toEqual({ hold: holdDTO });
  });
  it("200 on an idempotent replay", async () => {
    acquire.mockResolvedValue({ ok: true, hold: { ...holdDTO, replayed: true } });
    expect((await ACQUIRE(req({}))).status).toBe(200);
  });
  it("400 INVALID_INPUT when the body is not an object", async () => {
    const res = await ACQUIRE(new Request("http://localhost/x", { method: "POST", body: "null", headers: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });
  it("409 PRICE_CHANGED carries the fresh SAFE quote in details (no internal fields)", async () => {
    acquire.mockResolvedValue({ ok: false, error: "PRICE_CHANGED", quote });
    const res = await ACQUIRE(req({ offeringId: "o1" }, { "Idempotency-Key": "k" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("PRICE_CHANGED");
    expect(body.error.details.quote.total).toBe("50.00");
    expect(JSON.stringify(body)).not.toMatch(/customerId|providerId|requestFingerprint/);
  });
  it("maps RATE_LIMITED→429, IDEMPOTENCY_KEY_INVALID→400, NOT_BOOKABLE→404, VEHICLE_DATE_CONFLICT→409", async () => {
    const cases: [string, number][] = [["RATE_LIMITED", 429], ["IDEMPOTENCY_KEY_INVALID", 400], ["NOT_BOOKABLE", 404], ["VEHICLE_DATE_CONFLICT", 409], ["CAPACITY_EXCEEDED", 422], ["DAY_NOT_AVAILABLE", 422]];
    for (const [error, status] of cases) {
      acquire.mockResolvedValue({ ok: false, error });
      expect((await ACQUIRE(req({}))).status).toBe(status);
    }
  });
});

describe("DELETE /api/v1/me/rental-holds/{holdId} (release)", () => {
  it("200 with releasedCount on success", async () => {
    release.mockResolvedValue({ ok: true, releasedCount: 2 });
    const res = await RELEASE(new Request("http://localhost/x", { method: "DELETE", headers: { "Idempotency-Key": "k" } }), params("h1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ released: 2 });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ holdId: "h1", idempotencyKey: "k" }));
  });
  it("404 for a foreign/missing hold (HOLD_NOT_FOUND → NOT_FOUND)", async () => {
    release.mockResolvedValue({ ok: false, error: "HOLD_NOT_FOUND" });
    const res = await RELEASE(new Request("http://localhost/x", { method: "DELETE" }), params("h1"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/me/rental-holds/{holdId}/confirm", () => {
  it("201 with { id, status, rental } on a fresh confirmation", async () => {
    confirm.mockResolvedValue({ ok: true, booking: { id: "bk-1", status: "PENDING_PROVIDER", rentalSnapshot: { total: "40.00", dateKeys: ["2030-07-10"] } }, replayed: false });
    const res = await CONFIRM(req({ expectedQuote: { fingerprint: "fp" } }, { "Idempotency-Key": "ck" }), params("h1"));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ booking: { id: "bk-1", status: "PENDING_PROVIDER", rental: { total: "40.00", dateKeys: ["2030-07-10"] } } });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ holdId: "h1", idempotencyKey: "ck" }));
  });
  it("200 on idempotent replay", async () => {
    confirm.mockResolvedValue({ ok: true, booking: { id: "bk-1", status: "PENDING_PROVIDER", rentalSnapshot: {} }, replayed: true });
    expect((await CONFIRM(req({ expectedQuote: {} }), params("h1"))).status).toBe(200);
  });
  it("409 PRICE_CHANGED with the fresh quote; 409 HOLD_EXPIRED; 409 IDEMPOTENCY_MISMATCH", async () => {
    confirm.mockResolvedValue({ ok: false, error: "PRICE_CHANGED", quote });
    const drift = await CONFIRM(req({ expectedQuote: { fingerprint: "x" } }), params("h1"));
    expect(drift.status).toBe(409);
    expect((await drift.json()).error.details.quote.total).toBe("50.00");
    confirm.mockResolvedValue({ ok: false, error: "HOLD_EXPIRED" });
    expect((await CONFIRM(req({ expectedQuote: {} }), params("h1"))).status).toBe(409);
    confirm.mockResolvedValue({ ok: false, error: "IDEMPOTENCY_MISMATCH" });
    expect((await CONFIRM(req({ expectedQuote: {} }), params("h1"))).status).toBe(409);
  });
  it("400 when the body is not an object", async () => {
    const res = await CONFIRM(new Request("http://localhost/x", { method: "POST", body: "5" }), params("h1"));
    expect(res.status).toBe(400);
  });
});
