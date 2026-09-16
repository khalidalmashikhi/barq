import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const requireCustomer = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireCustomer: (...a: unknown[]) => requireCustomer(...a) };
});
const rl = vi.fn();
vi.mock("@/lib/rate-limit/rate-limiter", () => ({ checkRateLimit: (...a: unknown[]) => rl(...a) }));
const acquire = vi.fn();
vi.mock("../reservation/acquire-daily-rental-hold", () => ({ acquireDailyRentalHold: (...a: unknown[]) => acquire(...a) }));
const release = vi.fn();
vi.mock("../reservation/release-daily-rental-hold", () => ({ releaseDailyRentalHold: (...a: unknown[]) => release(...a) }));
const confirm = vi.fn();
vi.mock("./confirm-daily-rental-hold", () => ({ confirmDailyRentalHoldAndCreateBooking: (...a: unknown[]) => confirm(...a) }));

const { acquireRentalHoldForCustomer, releaseRentalHoldForCustomer, confirmRentalHoldForCustomer } = await import("./customer-rental-hold-actions");
const code = (r: { ok: boolean }): string | undefined => (r as { error?: string }).error;
const { UnauthenticatedError, ForbiddenError } = await import("@/lib/auth");

const OFFERING = "00000000-0000-0000-0000-0000000000a1";
const HOLD = "00000000-0000-0000-0000-0000000000b2";
const KEY = "idem-key-123456";
const quote = { offeringId: OFFERING, vehicleId: "v1", serviceId: "s1", currency: "OMR", dateKeys: ["2030-07-10"], days: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", priceSource: "BASE" }], chargeableDays: 1, total: "40.00", lowestDailyRate: "40.00", quoteFingerprint: "fp" };
const holdResult = { holdGroupId: HOLD, holdToken: "tok", status: "HELD", expiresAt: "2030-07-01T08:10:00.000Z", quote, replayed: false };

beforeEach(() => {
  vi.clearAllMocks();
  requireCustomer.mockResolvedValue({ customer: { id: "cust-1" }, barqUser: { id: "u1" } });
  rl.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  acquire.mockResolvedValue({ ok: true, hold: holdResult });
  release.mockResolvedValue({ ok: true, releasedCount: 1 });
  confirm.mockResolvedValue({ ok: true, booking: { id: "bk-1", status: "PENDING_PROVIDER", rentalSnapshot: { total: "40.00" } }, replayed: false });
});

const acqInput = (over = {}) => ({ offeringId: OFFERING, dateKeys: ["2030-07-10"], passengerCount: 2, idempotencyKey: KEY, ...over });

describe("acquireRentalHoldForCustomer", () => {
  it("rejects unauthenticated (UNAUTHENTICATED) without calling the authority", async () => {
    requireCustomer.mockRejectedValue(new UnauthenticatedError("no"));
    expect(await acquireRentalHoldForCustomer(acqInput())).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(acquire).not.toHaveBeenCalled();
  });
  it("maps a non-customer (ForbiddenError) to NO_CUSTOMER", async () => {
    requireCustomer.mockRejectedValue(new ForbiddenError("nope"));
    expect(await acquireRentalHoldForCustomer(acqInput())).toEqual({ ok: false, error: "NO_CUSTOMER" });
  });
  it("requires a valid idempotency key (empty/short rejected)", async () => {
    expect(code(await acquireRentalHoldForCustomer(acqInput({ idempotencyKey: null })))).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(code(await acquireRentalHoldForCustomer(acqInput({ idempotencyKey: "short" })))).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(acquire).not.toHaveBeenCalled();
  });
  it("rejects a malformed offeringId / dateKeys / passengerCount as INVALID_INPUT", async () => {
    expect(code(await acquireRentalHoldForCustomer(acqInput({ offeringId: "not-a-uuid" })))).toBe("INVALID_INPUT");
    expect(code(await acquireRentalHoldForCustomer(acqInput({ dateKeys: "nope" })))).toBe("INVALID_INPUT");
    expect(code(await acquireRentalHoldForCustomer(acqInput({ passengerCount: 2.5 })))).toBe("INVALID_INPUT");
  });
  it("uses the SESSION customer id (client cannot inject a customer id — the authority is called with the session id)", async () => {
    await acquireRentalHoldForCustomer(acqInput());
    expect(acquire).toHaveBeenCalledWith({}, expect.objectContaining({ customerId: "cust-1", offeringId: OFFERING, passengerCount: 2 }));
  });
  it("returns a SAFE hold DTO (public handles only, no customer/provider/internal ids)", async () => {
    const res = await acquireRentalHoldForCustomer(acqInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hold).toEqual({ holdId: HOLD, holdToken: "tok", status: "HELD", expiresAt: "2030-07-01T08:10:00.000Z", serviceId: "s1", offeringId: OFFERING, vehicleId: "v1", passengerCount: 2, perDate: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", source: "BASE" }], dateKeys: ["2030-07-10"], total: "40.00", currency: "OMR", quoteFingerprint: "fp", replayed: false });
    expect(JSON.stringify(res.hold)).not.toMatch(/cust-1|prov|requestFingerprint|customerId/);
  });
  it("rate-limits per customer", async () => {
    rl.mockReturnValue({ allowed: false, retryAfterSeconds: 60 });
    expect(code(await acquireRentalHoldForCustomer(acqInput()))).toBe("RATE_LIMITED");
    expect(acquire).not.toHaveBeenCalled();
  });
  it("maps PRICE_CHANGED (with quote) and other authority reasons", async () => {
    acquire.mockResolvedValue({ ok: false, reason: "PRICE_CHANGED", quote });
    const res = await acquireRentalHoldForCustomer(acqInput());
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.error).toBe("PRICE_CHANGED"); expect(res.quote).toBe(quote); }
    acquire.mockResolvedValue({ ok: false, reason: "VEHICLE_DATE_CONFLICT" });
    expect(code(await acquireRentalHoldForCustomer(acqInput()))).toBe("VEHICLE_DATE_CONFLICT");
    acquire.mockResolvedValue({ ok: false, reason: "INVALID_SELECTION" });
    expect(code(await acquireRentalHoldForCustomer(acqInput()))).toBe("INVALID_INPUT");
  });
});

describe("releaseRentalHoldForCustomer", () => {
  it("requires auth + a valid idempotency key", async () => {
    requireCustomer.mockRejectedValue(new UnauthenticatedError("no"));
    expect(code(await releaseRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY }))).toBe("UNAUTHENTICATED");
    requireCustomer.mockResolvedValue({ customer: { id: "cust-1" }, barqUser: { id: "u1" } });
    expect(code(await releaseRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: null }))).toBe("IDEMPOTENCY_KEY_INVALID");
  });
  it("maps NOT_FOUND → HOLD_NOT_FOUND (non-enumerating)", async () => {
    release.mockResolvedValue({ ok: false, reason: "NOT_FOUND" });
    expect(await releaseRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY })).toEqual({ ok: false, error: "HOLD_NOT_FOUND" });
  });
  it("returns releasedCount on success (release is idempotent)", async () => {
    release.mockResolvedValue({ ok: true, releasedCount: 0 });
    expect(await releaseRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY })).toEqual({ ok: true, releasedCount: 0 });
  });
});

describe("confirmRentalHoldForCustomer", () => {
  it("requires auth, a valid idempotency key, and an expected quote", async () => {
    expect(code(await confirmRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: null, expectedQuote: { fingerprint: "f" } }))).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(code(await confirmRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY, expectedQuote: null }))).toBe("INVALID_INPUT");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("passes the session customer + returns the booking; maps PRICE_CHANGED with the fresh quote", async () => {
    const ok = await confirmRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY, expectedQuote: { fingerprint: "f" } });
    expect(ok.ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith({}, expect.objectContaining({ customerId: "cust-1", holdGroupId: HOLD, confirmationIdempotencyKey: KEY }));
    confirm.mockResolvedValue({ ok: false, reason: "PRICE_CHANGED", quote });
    const drift = await confirmRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY, expectedQuote: { total: "40.00", currency: "OMR" } });
    expect(drift.ok).toBe(false);
    if (!drift.ok) { expect(drift.error).toBe("PRICE_CHANGED"); expect(drift.quote).toBe(quote); }
  });
  it("maps HOLD_EXPIRED / IDEMPOTENCY_MISMATCH straight through", async () => {
    confirm.mockResolvedValue({ ok: false, reason: "HOLD_EXPIRED" });
    expect(code(await confirmRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY, expectedQuote: { fingerprint: "f" } }))).toBe("HOLD_EXPIRED");
    confirm.mockResolvedValue({ ok: false, reason: "IDEMPOTENCY_MISMATCH" });
    expect(code(await confirmRentalHoldForCustomer({ holdId: HOLD, idempotencyKey: KEY, expectedQuote: { fingerprint: "f" } }))).toBe("IDEMPOTENCY_MISMATCH");
  });
});
