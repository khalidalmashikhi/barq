import { describe, it, expect } from "vitest";
import {
  MAX_CALENDAR_WINDOW_DAYS,
  DEFAULT_CALENDAR_WINDOW_DAYS,
  calendarWindowInclusiveDays,
  isWithinMaxCalendarWindow,
  type UnavailableReason,
  type OfferingCalendarVehicle,
} from "./offering-calendar-types";

// Phase 3C Slice C2a — the shared normalized calendar CONTRACT (types + constants +
// pure window validation). No resolver/DTO/route is defined here.

describe("calendar window constants", () => {
  it("maximum window is 62 inclusive dates; default is 32 inclusive dates", () => {
    expect(MAX_CALENDAR_WINDOW_DAYS).toBe(62);
    expect(DEFAULT_CALENDAR_WINDOW_DAYS).toBe(32);
  });
});

describe("calendarWindowInclusiveDays", () => {
  it("single-day window is 1 inclusive date", () => {
    expect(calendarWindowInclusiveDays("2026-08-20", "2026-08-20")).toBe(1);
  });
  it("a default-sized window (today..+31) spans exactly 32 inclusive dates", () => {
    // 2026-08-01 .. 2026-09-01 inclusive = 32 dates ( = DEFAULT_CALENDAR_WINDOW_DAYS).
    expect(calendarWindowInclusiveDays("2026-08-01", "2026-09-01")).toBe(DEFAULT_CALENDAR_WINDOW_DAYS);
  });
  it("a maximum-sized window spans exactly 62 inclusive dates", () => {
    // 2026-08-01 .. 2026-10-01 inclusive = 62 dates ( = MAX_CALENDAR_WINDOW_DAYS).
    expect(calendarWindowInclusiveDays("2026-08-01", "2026-10-01")).toBe(MAX_CALENDAR_WINDOW_DAYS);
  });
  it("null for reversed range or invalid keys", () => {
    expect(calendarWindowInclusiveDays("2026-08-21", "2026-08-20")).toBeNull();
    expect(calendarWindowInclusiveDays("2026-02-30", "2026-08-20")).toBeNull();
    expect(calendarWindowInclusiveDays("2026-08-20", "bad")).toBeNull();
  });
});

describe("isWithinMaxCalendarWindow", () => {
  it("accepts exactly the maximum, rejects one past it", () => {
    expect(isWithinMaxCalendarWindow("2026-08-01", "2026-10-01")).toBe(true); // 62
    expect(isWithinMaxCalendarWindow("2026-08-01", "2026-10-02")).toBe(false); // 63
    expect(isWithinMaxCalendarWindow("2026-08-21", "2026-08-20")).toBe(false); // reversed
  });
});

describe("normalized contract shape", () => {
  it("the UnavailableReason union includes GUIDE_RESERVATION_NOT_READY (guided fail-closed)", () => {
    const reasons: UnavailableReason[] = [
      "PAST",
      "NO_OPEN_DAY",
      "BLOCKED",
      "NO_PRICE",
      "VEHICLE_CONFLICT",
      "OFFERING_NOT_BOOKABLE",
      "GUIDE_RESERVATION_NOT_READY",
    ];
    expect(reasons).toContain("GUIDE_RESERVATION_NOT_READY");
    // There is deliberately no NO_OPEN_START_TIME reason.
    // @ts-expect-error start-time absence is not an availability reason in this contract
    const bad: UnavailableReason = "NO_OPEN_START_TIME";
    expect(bad).toBe("NO_OPEN_START_TIME");
  });

  it("a physical vehicle carries capacity metadata but NO remainingCapacity (binary availability)", () => {
    const v: OfferingCalendarVehicle = { id: "veh-1", label: "Land Cruiser", effectivePassengerCapacity: 6 };
    expect(v.effectivePassengerCapacity).toBe(6);
    // @ts-expect-error a single physical vehicle has no inventory count
    const withInventory: OfferingCalendarVehicle = { ...v, remainingCapacity: 3 };
    expect(withInventory.effectivePassengerCapacity).toBe(6);
  });
});
