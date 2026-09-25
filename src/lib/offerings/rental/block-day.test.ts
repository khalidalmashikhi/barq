import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: () => true }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const resolveApprovedProviderMock = vi.fn();
const assertProviderStillApprovedMock = vi.fn();
const loadOwnedRentalOfferingMock = vi.fn();
const assertRentalEditAuthorizedMock = vi.fn();
vi.mock("./rental-offering-authorization", () => ({
  resolveApprovedProvider: (...a: unknown[]) => resolveApprovedProviderMock(...a),
  assertProviderStillApproved: (...a: unknown[]) => assertProviderStillApprovedMock(...a),
  loadOwnedRentalOffering: (...a: unknown[]) => loadOwnedRentalOfferingMock(...a),
  assertRentalEditAuthorized: (...a: unknown[]) => assertRentalEditAuthorizedMock(...a),
}));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));

const dayFindUnique = vi.fn();
const dayCreateMany = vi.fn();
const dayUpdateMany = vi.fn();
const tx = { rentalOfferingDay: { findUnique: (...a: unknown[]) => dayFindUnique(...a), createMany: (...a: unknown[]) => dayCreateMany(...a), updateMany: (...a: unknown[]) => dayUpdateMany(...a) } };
const txnMock = vi.fn(async (cb: (t: unknown) => unknown) => cb(tx));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (cb: (t: unknown) => unknown) => txnMock(cb) } }));

const { blockRentalDays } = await import("./block-day");

// Future dates (never "past" against the real clock).
const D1 = "2099-07-10", D2 = "2099-07-11", D3 = "2099-07-12";

beforeEach(() => {
  resolveApprovedProviderMock.mockReset().mockResolvedValue({ ok: true, providerId: "prov-1" });
  assertProviderStillApprovedMock.mockReset().mockResolvedValue(null);
  loadOwnedRentalOfferingMock.mockReset().mockResolvedValue({ id: "off-1", status: "DRAFT", serviceOfferingKind: "VEHICLE_RENTAL", vehicle: {} });
  assertRentalEditAuthorizedMock.mockReset().mockResolvedValue(null);
  recordAuditEventMock.mockReset().mockResolvedValue(undefined);
  dayFindUnique.mockReset().mockResolvedValue(null);
  dayCreateMany.mockReset().mockResolvedValue({ count: 1 });
  dayUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  txnMock.mockClear();
});

describe("blockRentalDays (atomic batch)", () => {
  it("validates the whole set BEFORE any transaction: empty / past / malformed / over-window write nothing", async () => {
    expect(await blockRentalDays({ offeringId: "off-1", dates: [] })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await blockRentalDays({ offeringId: "off-1", dates: ["2020-01-01"] })).toEqual({ ok: false, error: "INVALID_DATE" });
    expect(await blockRentalDays({ offeringId: "off-1", dates: ["not-a-date"] })).toEqual({ ok: false, error: "INVALID_DATE" });
    // Inclusive span > 62 days → out of window.
    expect(await blockRentalDays({ offeringId: "off-1", dates: ["2099-07-01", "2099-12-01"] })).toEqual({ ok: false, error: "DATE_WINDOW_TOO_LARGE" });
    expect(txnMock).not.toHaveBeenCalled(); // no mutation attempted on invalid input
  });

  it("deduplicates repeated input dates (a repeated date is one day)", async () => {
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D1, D1, D1] });
    expect(res).toEqual({ ok: true, value: { created: 1, changed: 0, unchanged: 0, total: 1 } });
  });

  it("commits three valid dates together (missing → BLOCKED) with one transaction and per-day audit", async () => {
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D3, D1, D2] });
    expect(res).toEqual({ ok: true, value: { created: 3, changed: 0, unchanged: 0, total: 3 } });
    expect(txnMock).toHaveBeenCalledTimes(1); // ONE interactive transaction
    expect(recordAuditEventMock).toHaveBeenCalledTimes(3);
    // Ownership check uses the SESSION provider id, never a client-supplied one.
    expect(loadOwnedRentalOfferingMock).toHaveBeenCalledWith(tx, "prov-1", "off-1");
  });

  it("a failure on the middle date aborts the whole batch (third date never attempted)", async () => {
    // d1 created; d2 → createMany count 0 then reread finds no row → OFFERING_STATE_CONFLICT.
    dayFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    dayCreateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D1, D2, D3] });
    expect(res).toEqual({ ok: false, error: "OFFERING_STATE_CONFLICT" });
    expect(dayCreateMany).toHaveBeenCalledTimes(2); // stopped at d2; d3 never created (rolled back)
  });

  it("an audit failure rolls back the whole batch → UNKNOWN_ERROR (never a partial success)", async () => {
    recordAuditEventMock.mockRejectedValueOnce(new Error("audit down"));
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D1, D2] });
    expect(res).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });

  it("missing day → created; OPEN day → changed writing ONLY state (override/start-times untouched)", async () => {
    dayFindUnique.mockResolvedValueOnce({ id: "day-open", state: "OPEN" });
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D1] });
    expect(res.ok && res.value).toEqual({ created: 0, changed: 1, unchanged: 0, total: 1 });
    expect(dayUpdateMany).toHaveBeenCalledWith({ where: { id: "day-open", state: "OPEN" }, data: { state: "BLOCKED" } });
  });

  it("already-BLOCKED day is an idempotent no-op (no audit for it)", async () => {
    dayFindUnique.mockResolvedValueOnce({ id: "day-blk", state: "BLOCKED" });
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D1] });
    expect(res.ok && res.value).toEqual({ created: 0, changed: 0, unchanged: 1, total: 1 });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("a concurrent create converges without leaking a raw unique error", async () => {
    // create count 0 (someone inserted first) → reread finds BLOCKED → unchanged (no throw).
    dayFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "day-x", state: "BLOCKED" });
    dayCreateMany.mockResolvedValueOnce({ count: 0 });
    const res = await blockRentalDays({ offeringId: "off-1", dates: [D1] });
    expect(res).toEqual({ ok: true, value: { created: 0, changed: 0, unchanged: 1, total: 1 } });
  });

  it("a foreign/missing offering is non-enumerating (uniform OFFERING_NOT_FOUND)", async () => {
    loadOwnedRentalOfferingMock.mockResolvedValue(null);
    expect(await blockRentalDays({ offeringId: "off-x", dates: [D1] })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
  });

  it("an archived offering is immutable", async () => {
    loadOwnedRentalOfferingMock.mockResolvedValue({ id: "off-1", status: "ARCHIVED", serviceOfferingKind: "VEHICLE_RENTAL", vehicle: {} });
    expect(await blockRentalDays({ offeringId: "off-1", dates: [D1] })).toEqual({ ok: false, error: "OFFERING_ARCHIVED" });
  });

  it("returns the auth result when the provider is not approved (client identity never trusted)", async () => {
    resolveApprovedProviderMock.mockResolvedValue({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(await blockRentalDays({ offeringId: "off-1", dates: [D1] })).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(txnMock).not.toHaveBeenCalled();
  });
});
