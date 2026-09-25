import { describe, it, expect } from "vitest";
import {
  dateKeysInInclusiveRange,
  isPastKey,
  isConfigurableKey,
  monthDayKeys,
  toggleKey,
  deriveRentalCalendarCell,
} from "./calendar-selection";

describe("calendar-selection (pure)", () => {
  it("expands an inclusive contiguous range, order-independent", () => {
    expect(dateKeysInInclusiveRange("2030-07-10", "2030-07-12")).toEqual(["2030-07-10", "2030-07-11", "2030-07-12"]);
    expect(dateKeysInInclusiveRange("2030-07-12", "2030-07-10")).toEqual(["2030-07-10", "2030-07-11", "2030-07-12"]);
    expect(dateKeysInInclusiveRange("2030-07-10", "2030-07-10")).toEqual(["2030-07-10"]);
  });

  it("crosses month boundaries correctly (no browser-local drift)", () => {
    expect(dateKeysInInclusiveRange("2030-07-30", "2030-08-02")).toEqual(["2030-07-30", "2030-07-31", "2030-08-01", "2030-08-02"]);
  });

  it("returns [] for an invalid/impossible date key", () => {
    expect(dateKeysInInclusiveRange("2030-02-31", "2030-03-01")).toEqual([]);
    expect(dateKeysInInclusiveRange("nope", "2030-03-01")).toEqual([]);
  });

  it("isPastKey uses exact string comparison (today is not past)", () => {
    expect(isPastKey("2030-06-30", "2030-07-01")).toBe(true);
    expect(isPastKey("2030-07-01", "2030-07-01")).toBe(false);
    expect(isPastKey("2030-07-02", "2030-07-01")).toBe(false);
  });

  it("isConfigurableKey requires today-or-later AND within the forward window", () => {
    const today = "2030-07-01";
    expect(isConfigurableKey("2030-06-30", today, 62)).toBe(false); // past
    expect(isConfigurableKey("2030-07-01", today, 62)).toBe(true); // today
    expect(isConfigurableKey("2030-08-31", today, 62)).toBe(true); // within 62 days
    expect(isConfigurableKey("2030-09-02", today, 62)).toBe(false); // day 63 — outside window (exclusive end)
    expect(isConfigurableKey("bad", today, 62)).toBe(false);
  });

  it("monthDayKeys enumerates every day of a month", () => {
    expect(monthDayKeys(2030, 1)).toHaveLength(28); // Feb 2030
    const july = monthDayKeys(2030, 6);
    expect(july).toHaveLength(31);
    expect(july[0]).toBe("2030-07-01");
    expect(july[30]).toBe("2030-07-31");
  });

  it("toggleKey adds then removes a key immutably (single + non-consecutive selection)", () => {
    const empty = new Set<string>();
    const a = toggleKey(empty, "2030-07-10");
    expect([...a]).toEqual(["2030-07-10"]);
    expect(empty.size).toBe(0); // original untouched
    const b = toggleKey(a, "2030-07-14"); // non-consecutive
    expect([...b].sort()).toEqual(["2030-07-10", "2030-07-14"]);
    const c = toggleKey(b, "2030-07-10"); // toggle off
    expect([...c]).toEqual(["2030-07-14"]);
  });
});

describe("deriveRentalCalendarCell (cell render logic)", () => {
  const base = { baseDailyAmount: "40.00", todayKey: "2030-07-01", windowDays: 62, selected: false };

  it("renders OPEN/BLOCKED/NONE distinctly", () => {
    expect(deriveRentalCalendarCell("2030-07-10", { ...base, day: { state: "OPEN", dailyAmount: "40.00", priceSource: "BASE" } }).state).toBe("OPEN");
    expect(deriveRentalCalendarCell("2030-07-10", { ...base, day: { state: "BLOCKED", dailyAmount: "40.00", priceSource: "BASE" } }).state).toBe("BLOCKED");
    expect(deriveRentalCalendarCell("2030-07-10", base).state).toBe("NONE");
  });

  it("override price wins over base; base shows when there is no override", () => {
    const override = deriveRentalCalendarCell("2030-07-10", { ...base, day: { state: "OPEN", dailyAmount: "55.00", priceSource: "OVERRIDE" } });
    expect(override).toMatchObject({ priceAmount: "55.00", priceSource: "OVERRIDE" });
    const noOverride = deriveRentalCalendarCell("2030-07-10", { ...base, day: { state: "OPEN", dailyAmount: "40.00", priceSource: "BASE" } });
    expect(noOverride).toMatchObject({ priceAmount: "40.00", priceSource: "BASE" });
    expect(deriveRentalCalendarCell("2030-07-10", base).priceAmount).toBe("40.00"); // NONE → base
  });

  it("marks past and out-of-window cells non-configurable, and in-window future cells configurable", () => {
    expect(deriveRentalCalendarCell("2030-06-30", base)).toMatchObject({ configurable: false, past: true });
    expect(deriveRentalCalendarCell("2030-09-02", base)).toMatchObject({ configurable: false, past: false }); // beyond day 62
    expect(deriveRentalCalendarCell("2030-07-05", base).configurable).toBe(true);
  });

  it("carries the selected flag through", () => {
    expect(deriveRentalCalendarCell("2030-07-05", { ...base, selected: true }).selected).toBe(true);
  });
});
