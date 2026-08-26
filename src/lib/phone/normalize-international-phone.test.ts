import { describe, it, expect } from "vitest";
import {
  normalizeInternationalPhone,
  normalizeInternationalPhoneParts,
} from "./normalize-international-phone";

// AUTH-INTERNATIONAL-PHONE-1 — the international E.164 authority. Covers the gate's
// §12 matrix (OM/SA/AE/GB/US), backward-compatibility for legacy Oman forms, and the
// rejection / canonical-duplicate contract.

describe("normalizeInternationalPhone — canonical E.164 across countries", () => {
  it("Oman national input canonicalizes to +968XXXXXXXX (default region OM)", () => {
    expect(normalizeInternationalPhone("98115159")).toEqual({ ok: true, e164: "+96898115159" });
  });

  it("Saudi Arabia national mobile → +966…", () => {
    expect(normalizeInternationalPhoneParts({ countryCode: "SA", nationalNumber: "512345678" })).toEqual({
      ok: true,
      e164: "+966512345678",
    });
  });

  it("UAE national mobile → +971…", () => {
    expect(normalizeInternationalPhoneParts({ countryCode: "AE", nationalNumber: "501234567" })).toEqual({
      ok: true,
      e164: "+971501234567",
    });
  });

  it("United Kingdom national mobile → +44…", () => {
    expect(normalizeInternationalPhoneParts({ countryCode: "GB", nationalNumber: "7911123456" })).toEqual({
      ok: true,
      e164: "+447911123456",
    });
  });

  it("United States national number → +1…", () => {
    expect(normalizeInternationalPhoneParts({ countryCode: "US", nationalNumber: "2125551234" })).toEqual({
      ok: true,
      e164: "+12125551234",
    });
  });

  it("a full E.164 string parses regardless of the default region", () => {
    expect(normalizeInternationalPhone("+447911123456", "OM")).toEqual({ ok: true, e164: "+447911123456" });
  });
});

describe("normalizeInternationalPhone — backward compatibility (legacy Oman forms)", () => {
  it("every legacy Oman input form converges to the SAME canonical identity", () => {
    const forms = ["98115159", "+96898115159", "96898115159", "0096898115159", "+968 9811 5159", "+968-9811-5159"];
    const canonical = new Set(
      forms.map((f) => {
        const r = normalizeInternationalPhone(f, "OM");
        return r.ok ? r.e164 : "REJECTED";
      })
    );
    expect(canonical.size).toBe(1);
    expect([...canonical][0]).toBe("+96898115159");
  });
});

describe("normalizeInternationalPhone — rejection contract", () => {
  it("rejects empty / whitespace", () => {
    expect(normalizeInternationalPhone("", "OM")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeInternationalPhone("   ", "OM")).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("rejects a malformed number (letters)", () => {
    expect(normalizeInternationalPhone("abc", "OM").ok).toBe(false);
  });

  it("rejects a too-short number", () => {
    expect(normalizeInternationalPhone("12", "OM")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
  });

  it("rejects an impossible number", () => {
    expect(normalizeInternationalPhone("+9991234567", "OM")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
  });

  it("rejects a reserved/invalid GB fictional number (isValid=false)", () => {
    // 07700 900xxx is Ofcom-reserved for drama; possible-shaped but NOT valid.
    expect(normalizeInternationalPhoneParts({ countryCode: "GB", nationalNumber: "7700900123" }).ok).toBe(false);
  });

  it("rejects an unknown ISO country as INVALID_COUNTRY (never guessed)", () => {
    expect(normalizeInternationalPhoneParts({ countryCode: "ZZ", nationalNumber: "512345678" })).toEqual({
      ok: false,
      reason: "INVALID_COUNTRY",
    });
    expect(normalizeInternationalPhone("512345678", "ZZ")).toEqual({ ok: false, reason: "INVALID_COUNTRY" });
  });

  it("rejects a non-two-letter ISO as INVALID_COUNTRY", () => {
    expect(normalizeInternationalPhoneParts({ countryCode: "OMN", nationalNumber: "98115159" })).toEqual({
      ok: false,
      reason: "INVALID_COUNTRY",
    });
  });
});

describe("normalizeInternationalPhone — no formatting/country-selection duplicates", () => {
  it("spaced, dashed, and E.164 SA inputs collapse to one identity", () => {
    const a = normalizeInternationalPhoneParts({ countryCode: "SA", nationalNumber: "51 234 5678" });
    const b = normalizeInternationalPhoneParts({ countryCode: "SA", nationalNumber: "51-234-5678" });
    const c = normalizeInternationalPhone("+966512345678", "OM");
    expect(a).toEqual({ ok: true, e164: "+966512345678" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("a full +966 number entered while OM is selected canonicalizes to its real country (no bypass)", () => {
    // The stored identity reflects the actual number; uniqueness keys on this E.164.
    expect(normalizeInternationalPhoneParts({ countryCode: "OM", nationalNumber: "+966512345678" })).toEqual({
      ok: true,
      e164: "+966512345678",
    });
  });
});
