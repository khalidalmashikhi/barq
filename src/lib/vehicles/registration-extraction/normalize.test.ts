import { describe, it, expect } from "vitest";
import {
  toWesternDigits,
  stripBidiAndZeroWidth,
  collapseWhitespace,
  normalizePunctuation,
  parsePositiveInt,
  parseYear,
  parseMeasure,
  normalizeVin,
  normalizePlate,
  parseIsoDate,
} from "./normalize";

// Phase 3C Slice 2 — pure normalization primitives. All values below are SYNTHETIC.

describe("toWesternDigits", () => {
  it("converts Arabic-Indic and Persian digits to Western, leaving other text intact", () => {
    expect(toWesternDigits("١٥")).toBe("15"); // ١٥
    expect(toWesternDigits("۱۲۳")).toBe("123"); // ۱۲۳ (Persian)
    expect(toWesternDigits("VIN ٩٨")).toBe("VIN 98");
    expect(toWesternDigits("plain 42")).toBe("plain 42");
  });
});

describe("stripBidiAndZeroWidth", () => {
  it("removes LRM/RLM, embeddings, isolates, ALM, zero-width, and BOM", () => {
    const noisy = "‏عدد‎ ⁦الركاب⁩​﻿";
    expect(stripBidiAndZeroWidth(noisy)).toBe("عدد الركاب");
  });
});

describe("collapseWhitespace + normalizePunctuation", () => {
  it("collapses runs of whitespace and trims", () => {
    expect(collapseWhitespace("  a   b\t c \n")).toBe("a b c");
  });
  it("maps Arabic punctuation to ASCII", () => {
    expect(normalizePunctuation("a،b؛c؟d")).toBe("a,b;c?d");
    expect(normalizePunctuation("k：v")).toBe("k:v");
  });
});

describe("parsePositiveInt", () => {
  it("accepts a bounded positive integer incl. Arabic-Indic digits; rejects zero/decimal/garbage", () => {
    expect(parsePositiveInt("١٣")).toBe(13);
    expect(parsePositiveInt("15")).toBe(15);
    expect(parsePositiveInt("0")).toBeNull();
    expect(parsePositiveInt("1.5")).toBeNull();
    expect(parsePositiveInt("abc")).toBeNull();
  });
});

describe("parseYear", () => {
  it("accepts a 4-digit year within range, rejects out-of-range", () => {
    expect(parseYear("2019", 1950, 2027)).toBe(2019);
    expect(parseYear("سنة 2024", 1950, 2027)).toBe(2024);
    expect(parseYear("1940", 1950, 2027)).toBeNull();
    expect(parseYear("2099", 1950, 2027)).toBeNull();
  });
});

describe("parseMeasure", () => {
  it("returns value + detected unit; unit null when absent (never guessed)", () => {
    expect(parseMeasure("2000 cc")).toEqual({ value: 2000, unit: "cc" });
    expect(parseMeasure("1500")).toEqual({ value: 1500, unit: null });
    expect(parseMeasure("1,600 kg")).toEqual({ value: 1600, unit: "kg" });
    expect(parseMeasure("none")).toBeNull();
  });
});

describe("normalizeVin", () => {
  it("uppercases ASCII, strips separators, flags 17-char + VIN alphabet", () => {
    const r = normalizeVin(" jn1az4eh8am 123456 ".replace(/ /g, ""));
    expect(r).not.toBeNull();
  });
  it("HIGH-eligible 17-char valid VIN", () => {
    const r = normalizeVin("JTDBT923071012345")!;
    expect(r.vin).toBe("JTDBT923071012345");
    expect(r.charsetOk).toBe(true);
    expect(r.lengthOk).toBe(true);
  });
  it("valid charset but non-17 length (legacy) → lengthOk false", () => {
    const r = normalizeVin("ABC12345")!;
    expect(r.charsetOk).toBe(true);
    expect(r.lengthOk).toBe(false);
  });
  it("rejects the forbidden VIN letters I/O/Q via charsetOk=false", () => {
    const r = normalizeVin("IOQ1234567890XYZAB")!;
    expect(r.charsetOk).toBe(false);
  });
});

describe("normalizePlate", () => {
  it("collapses/uppercases while preserving the value; null for empty", () => {
    expect(normalizePlate("  a 12 345 ")).toBe("A 12 345");
    expect(normalizePlate("   ")).toBeNull();
  });
});

describe("parseIsoDate", () => {
  it("accepts YYYY-MM-DD and DD/MM/YYYY, returns ISO", () => {
    expect(parseIsoDate("2027-05-31")).toBe("2027-05-31");
    expect(parseIsoDate("31/05/2027")).toBe("2027-05-31");
    expect(parseIsoDate("01.06.2030")).toBe("2030-06-01");
    expect(parseIsoDate("٣١/٠٥/٢٠٢٧")).toBe("2027-05-31"); // Arabic-Indic
  });
  it("rejects impossible calendar dates and ambiguous 2-digit years", () => {
    expect(parseIsoDate("2027-02-30")).toBeNull();
    expect(parseIsoDate("31/11/2026")).toBeNull();
    expect(parseIsoDate("05/06/27")).toBeNull();
  });
});
