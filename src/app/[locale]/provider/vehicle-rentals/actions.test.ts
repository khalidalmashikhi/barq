import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async () => {
  const errors = await vi.importActual<typeof import("@/lib/auth/errors")>("@/lib/auth/errors");
  return { UnauthenticatedError: errors.UnauthenticatedError };
});

const domain = {
  createRentalOffering: vi.fn(),
  updateRentalOffering: vi.fn(),
  publishRentalOffering: vi.fn(),
  suspendRentalOffering: vi.fn(),
  archiveRentalOffering: vi.fn(),
  bulkOpenRentalDays: vi.fn(),
  blockRentalDays: vi.fn(),
  setDailyOverride: vi.fn(),
};
vi.mock("@/lib/offerings/rental", () => domain);

const {
  createRentalOfferingAction,
  updateRentalOfferingAction,
  publishRentalOfferingAction,
  suspendRentalOfferingAction,
  archiveRentalOfferingAction,
  openRentalDaysAction,
  blockRentalDaysAction,
  setRentalDayOverrideAction,
} = await import("./actions");

beforeEach(() => Object.values(domain).forEach((m) => m.mockReset()));

const validCreate = { serviceId: "svc-1", vehicleId: "veh-1", baseDailyAmount: "40.00", currency: "OMR" };

describe("rental workspace server actions", () => {
  it("createRentalOfferingAction: success returns the new offering id; providerId is NEVER forwarded", async () => {
    domain.createRentalOffering.mockResolvedValue({ ok: true, value: { id: "off-1" } });
    // A malicious client adds providerId — it must be dropped (server derives identity).
    const res = await createRentalOfferingAction({ ...validCreate, providerId: "evil" } as never);
    expect(res).toEqual({ ok: true, offeringId: "off-1" });
    const arg = domain.createRentalOffering.mock.calls[0]![0];
    expect(arg).toEqual({ serviceId: "svc-1", vehicleId: "veh-1", baseDailyAmount: "40.00", currency: "OMR", offeringCapacityOverride: null });
    expect("providerId" in arg).toBe(false);
  });

  it("createRentalOfferingAction: maps a domain error code without leaking", async () => {
    domain.createRentalOffering.mockResolvedValue({ ok: false, error: "OFFERING_ALREADY_ACTIVE" });
    expect(await createRentalOfferingAction(validCreate)).toEqual({ ok: false, code: "OFFERING_ALREADY_ACTIVE" });
  });

  it("createRentalOfferingAction: invalid input short-circuits before the domain call", async () => {
    expect(await createRentalOfferingAction({ ...validCreate, serviceId: "" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await createRentalOfferingAction({ ...validCreate, offeringCapacityOverride: "-3" })).toEqual({ ok: false, code: "INVALID_CAPACITY_OVERRIDE" });
    expect(domain.createRentalOffering).not.toHaveBeenCalled();
  });

  it("createRentalOfferingAction: thrown UnauthenticatedError → UNAUTHENTICATED; other throw → UNKNOWN_ERROR", async () => {
    domain.createRentalOffering.mockRejectedValueOnce(new UnauthenticatedError());
    expect(await createRentalOfferingAction(validCreate)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    domain.createRentalOffering.mockRejectedValueOnce(new Error("prisma exploded"));
    expect(await createRentalOfferingAction(validCreate)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
  });

  it("updateRentalOfferingAction: only forwards provided fields; needs an offeringId", async () => {
    expect(await updateRentalOfferingAction({ offeringId: "" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    domain.updateRentalOffering.mockResolvedValue({ ok: true, value: {} });
    const res = await updateRentalOfferingAction({ offeringId: "off-1", baseDailyAmount: "55.00" });
    expect(res).toEqual({ ok: true });
    expect(domain.updateRentalOffering.mock.calls[0]![0]).toEqual({ offeringId: "off-1", baseDailyAmount: "55.00" });
  });

  it("publish/suspend/archive: forward the offeringId and map the result", async () => {
    domain.publishRentalOffering.mockResolvedValue({ ok: false, error: "NO_PUBLISHABLE_DAY" });
    expect(await publishRentalOfferingAction("off-1")).toEqual({ ok: false, code: "NO_PUBLISHABLE_DAY" });
    expect(domain.publishRentalOffering).toHaveBeenCalledWith("off-1");

    domain.suspendRentalOffering.mockResolvedValue({ ok: true, value: {} });
    expect(await suspendRentalOfferingAction("off-1")).toEqual({ ok: true });

    domain.archiveRentalOffering.mockResolvedValue({ ok: true, value: {} });
    expect(await archiveRentalOfferingAction("off-1")).toEqual({ ok: true });
    expect(await archiveRentalOfferingAction(123)).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("openRentalDaysAction: forwards the date array + reopen flag; rejects an empty array", async () => {
    expect(await openRentalDaysAction({ offeringId: "off-1", dateKeys: [] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    domain.bulkOpenRentalDays.mockResolvedValue({ ok: true, value: {} });
    await openRentalDaysAction({ offeringId: "off-1", dateKeys: ["2030-07-10", "2030-07-11"], reopenBlocked: true });
    expect(domain.bulkOpenRentalDays).toHaveBeenCalledWith({ offeringId: "off-1", dates: ["2030-07-10", "2030-07-11"], reopenBlocked: true });
  });

  it("blockRentalDaysAction: delegates to the ATOMIC batch domain fn (one call, all dates) and maps the result", async () => {
    expect(await blockRentalDaysAction({ offeringId: "off-1", dateKeys: [] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    domain.blockRentalDays.mockResolvedValue({ ok: true, value: { created: 3, changed: 0, unchanged: 0, total: 3 } });
    const res = await blockRentalDaysAction({ offeringId: "off-1", dateKeys: ["2030-07-10", "2030-07-11", "2030-07-12"] });
    expect(res).toEqual({ ok: true });
    // ONE atomic call with the whole date set — never a per-date loop that could partially succeed.
    expect(domain.blockRentalDays).toHaveBeenCalledTimes(1);
    expect(domain.blockRentalDays).toHaveBeenCalledWith({ offeringId: "off-1", dates: ["2030-07-10", "2030-07-11", "2030-07-12"] });

    domain.blockRentalDays.mockResolvedValue({ ok: false, error: "INVALID_DATE" });
    expect(await blockRentalDaysAction({ offeringId: "off-1", dateKeys: ["2030-07-10"] })).toEqual({ ok: false, code: "INVALID_DATE" });
  });

  it("setRentalDayOverrideAction: accepts a money string or null; rejects other amounts", async () => {
    domain.setDailyOverride.mockResolvedValue({ ok: true, value: {} });
    await setRentalDayOverrideAction({ offeringId: "off-1", dateKey: "2030-07-10", amount: "50.00" });
    expect(domain.setDailyOverride).toHaveBeenCalledWith({ offeringId: "off-1", date: "2030-07-10", dailyAmountOverride: "50.00" });
    await setRentalDayOverrideAction({ offeringId: "off-1", dateKey: "2030-07-10", amount: null });
    expect(domain.setDailyOverride).toHaveBeenLastCalledWith({ offeringId: "off-1", date: "2030-07-10", dailyAmountOverride: null });
    expect(await setRentalDayOverrideAction({ offeringId: "off-1", dateKey: "2030-07-10", amount: 99 })).toEqual({ ok: false, code: "INVALID_MONEY" });
  });
});
