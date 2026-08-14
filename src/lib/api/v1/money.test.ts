import { describe, it, expect } from "vitest";
import { normalizeDecimalString, parseMoneyString, toMoneyDTO } from "./money";

// MoneyDTO amount MUST remain a decimal STRING (never a float) — Gate 1 contract.

describe("normalizeDecimalString", () => {
  it("pads an integer string to 2 decimals", () => {
    expect(normalizeDecimalString("25")).toBe("25.00");
  });
  it("pads a 1-decimal string to 2 decimals", () => {
    expect(normalizeDecimalString("25.5")).toBe("25.50");
  });
  it("preserves an already-2-decimal string", () => {
    expect(normalizeDecimalString("1234.00")).toBe("1234.00");
  });
  it("handles zero", () => {
    expect(normalizeDecimalString("0")).toBe("0.00");
  });
  it("never returns a number type", () => {
    expect(typeof normalizeDecimalString("10")).toBe("string");
  });
});

describe("parseMoneyString", () => {
  it("returns null for null/empty", () => {
    expect(parseMoneyString(null)).toBeNull();
    expect(parseMoneyString(undefined)).toBeNull();
    expect(parseMoneyString("")).toBeNull();
  });
  it("splits '<amount> <currency>' and normalizes the amount to a 2dp string", () => {
    expect(parseMoneyString("25 OMR")).toEqual({ amount: "25.00", currency: "OMR" });
    expect(parseMoneyString("25.5 OMR")).toEqual({ amount: "25.50", currency: "OMR" });
    expect(parseMoneyString("1234.00 OMR")).toEqual({ amount: "1234.00", currency: "OMR" });
  });
  it("keeps amount as a string", () => {
    expect(typeof parseMoneyString("25 OMR")!.amount).toBe("string");
  });
  it("returns null for a malformed (non-numeric) amount", () => {
    expect(parseMoneyString("abc OMR")).toBeNull();
    expect(parseMoneyString("OMR")).toBeNull();
  });
});

describe("toMoneyDTO", () => {
  it("normalizes a raw decimal string + currency", () => {
    expect(toMoneyDTO("25", "OMR")).toEqual({ amount: "25.00", currency: "OMR" });
  });
});
