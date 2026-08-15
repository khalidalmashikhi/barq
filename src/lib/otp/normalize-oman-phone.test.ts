import { describe, it, expect } from "vitest";
import { normalizeOmanPhone } from "./normalize-oman-phone";

const CANON = "+96898115159";

describe("normalizeOmanPhone — valid inputs canonicalize to +968XXXXXXXX", () => {
  it("bare 8 national digits", () => {
    expect(normalizeOmanPhone("98115159")).toEqual({ ok: true, e164: CANON });
  });
  it("already-canonical E.164 is unchanged", () => {
    expect(normalizeOmanPhone("+96898115159")).toEqual({ ok: true, e164: CANON });
  });
  it("country code without '+' (11 digits)", () => {
    expect(normalizeOmanPhone("96898115159")).toEqual({ ok: true, e164: CANON });
  });
  it("'00' international prefix", () => {
    expect(normalizeOmanPhone("0096898115159")).toEqual({ ok: true, e164: CANON });
  });
  it("strips spaces, dashes, parentheses, dots and leading/trailing whitespace", () => {
    for (const v of ["+968 9811 5159", "  98115159  ", "+968-9811-5159", "(00968) 9811.5159", "968 98115159"]) {
      expect(normalizeOmanPhone(v)).toEqual({ ok: true, e164: CANON });
    }
  });
  it("accepts any 8-digit national number (leading digit not over-restricted)", () => {
    expect(normalizeOmanPhone("71234567")).toEqual({ ok: true, e164: "+96871234567" });
  });
});

describe("normalizeOmanPhone — invalid inputs are rejected", () => {
  it("empty / whitespace-only", () => {
    expect(normalizeOmanPhone("")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeOmanPhone("   ")).toEqual({ ok: false, reason: "EMPTY" });
  });
  it("7 national digits (too short)", () => {
    expect(normalizeOmanPhone("9811515")).toEqual({ ok: false, reason: "INVALID_LENGTH" });
    expect(normalizeOmanPhone("+9689811515")).toEqual({ ok: false, reason: "INVALID_LENGTH" });
  });
  it("9 national digits (too long)", () => {
    expect(normalizeOmanPhone("981151599")).toEqual({ ok: false, reason: "INVALID_LENGTH" });
    expect(normalizeOmanPhone("+968981151599")).toEqual({ ok: false, reason: "INVALID_LENGTH" });
  });
  it("non-digit garbage", () => {
    expect(normalizeOmanPhone("abcd")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
    expect(normalizeOmanPhone("98a15159")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
  });
  it("unsupported country codes are rejected, never coerced to Oman", () => {
    expect(normalizeOmanPhone("+971501234567")).toEqual({ ok: false, reason: "UNSUPPORTED_COUNTRY" });
    expect(normalizeOmanPhone("+15551234567")).toEqual({ ok: false, reason: "UNSUPPORTED_COUNTRY" });
    expect(normalizeOmanPhone("0097150123456")).toEqual({ ok: false, reason: "UNSUPPORTED_COUNTRY" });
  });
  it("leading domestic-trunk '0' form is not a standard Oman representation", () => {
    expect(normalizeOmanPhone("098115159")).toEqual({ ok: false, reason: "INVALID_LENGTH" });
  });
});

describe("normalizeOmanPhone — security: equivalent forms collapse to ONE rate-limit key", () => {
  it("every accepted representation of the same number yields the identical E.164 (so cooldown/daily-cap cannot be multiplied by formatting)", () => {
    const equivalents = [
      "98115159",
      "+96898115159",
      "96898115159",
      "0096898115159",
      "+968 9811 5159",
      "968-9811-5159",
      " 98115159 ",
    ];
    const keys = new Set(
      equivalents.map((v) => {
        const r = normalizeOmanPhone(v);
        return r.ok ? r.e164 : `REJECTED:${(r as { reason: string }).reason}`;
      })
    );
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(CANON);
  });

  it("a non-Oman number and a valid Oman number never collapse to the same key", () => {
    const foreign = normalizeOmanPhone("+971501234567");
    const oman = normalizeOmanPhone("+96898115159");
    expect(foreign.ok).toBe(false);
    expect(oman.ok).toBe(true);
  });
});
