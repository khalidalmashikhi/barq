import { describe, it, expect } from "vitest";
import { parseBookingQuantity } from "./parse-booking-quantity";

describe("parseBookingQuantity", () => {
  it("MISSING (absent key) defaults to 1 (the existing contract)", () => {
    expect(parseBookingQuantity(null)).toEqual({ ok: true, value: 1 });
  });

  it("accepts a valid positive integer string", () => {
    expect(parseBookingQuantity("1")).toEqual({ ok: true, value: 1 });
    expect(parseBookingQuantity("5")).toEqual({ ok: true, value: 5 });
    expect(parseBookingQuantity(" 3 ")).toEqual({ ok: true, value: 3 }); // trimmed
  });

  it("FAILS CLOSED for explicitly-supplied invalid values (never coerced to 1)", () => {
    for (const bad of ["", " ", "0", "-1", "1.5", "abc", "1e3", "0x2", "+2", "NaN", "Infinity"]) {
      expect(parseBookingQuantity(bad), `input ${JSON.stringify(bad)}`).toEqual({ ok: false });
    }
  });

  it("rejects an unsafe/huge integer string", () => {
    expect(parseBookingQuantity("99999999999999999999")).toEqual({ ok: false });
  });

  it("rejects a non-string (e.g. a File)", () => {
    expect(parseBookingQuantity(new File([], "x") as unknown as FormDataEntryValue)).toEqual({ ok: false });
  });
});
