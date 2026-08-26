import { describe, it, expect } from "vitest";
import { resolveAuthPhone, canRequestOtp } from "./phone-entry";
import { DEFAULT_COUNTRY, findCountryByIso, COUNTRIES } from "@/lib/countries/registry";

// AUTH-INTERNATIONAL-PHONE-1 — resolveAuthPhone now canonicalizes ANY selected
// country's national number to E.164 (via the shared libphonenumber-js authority),
// not just Oman. Oman stays the default; every curated country is auth-supported.

const OMAN = DEFAULT_COUNTRY;
const SAUDI = findCountryByIso("SA")!;
const UAE = findCountryByIso("AE")!;
const UK = findCountryByIso("GB")!;
const USA = findCountryByIso("US")!;

describe("registry — international auth, Oman default", () => {
  it("Oman is present, is the default, and is auth-supported", () => {
    expect(OMAN.iso).toBe("OM");
    expect(OMAN.callingCode).toBe("+968");
    expect(OMAN.authSupported).toBe(true);
  });

  it("many countries are auth-supported (no longer Oman-only)", () => {
    const supported = COUNTRIES.filter((c) => c.authSupported);
    expect(supported.length).toBeGreaterThan(1);
    expect(supported.every((c) => c.authSupported)).toBe(true);
    expect(COUNTRIES.map((c) => c.iso)).toContain("SA");
  });
});

describe("resolveAuthPhone — canonical E.164 per selected country", () => {
  it("Oman national number → the legacy canonical +968XXXXXXXX", () => {
    expect(resolveAuthPhone(OMAN, "98115159")).toEqual({ ok: true, e164: "+96898115159" });
  });

  it("Saudi Arabia national mobile → +966…", () => {
    expect(resolveAuthPhone(SAUDI, "512345678")).toEqual({ ok: true, e164: "+966512345678" });
  });

  it("UAE national mobile → +971…", () => {
    expect(resolveAuthPhone(UAE, "501234567")).toEqual({ ok: true, e164: "+971501234567" });
  });

  it("UK national mobile → +44…", () => {
    expect(resolveAuthPhone(UK, "7911123456")).toEqual({ ok: true, e164: "+447911123456" });
  });

  it("US national number → +1…", () => {
    expect(resolveAuthPhone(USA, "2125551234")).toEqual({ ok: true, e164: "+12125551234" });
  });

  it("all P0-1-accepted Oman input forms still converge to ONE canonical identity", () => {
    const forms = ["98115159", "+96898115159", "96898115159", "0096898115159", "+968 9811 5159"];
    const results = new Set(
      forms.map((f) => {
        const r = resolveAuthPhone(OMAN, f);
        return r.ok ? r.e164 : "REJECTED";
      })
    );
    expect(results.size).toBe(1);
    expect([...results][0]).toBe("+96898115159");
  });

  it("changing the country changes the canonical calling code", () => {
    expect(resolveAuthPhone(OMAN, "98115159").ok).toBe(true);
    expect(resolveAuthPhone(SAUDI, "512345678")).toEqual({ ok: true, e164: "+966512345678" });
  });

  it("rejects an invalid number for the selected country", () => {
    expect(resolveAuthPhone(OMAN, "123")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
    expect(resolveAuthPhone(OMAN, "")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
    expect(resolveAuthPhone(SAUDI, "1")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
  });

  it("does not coerce an Oman-looking number to a validly-shaped foreign number", () => {
    // "98115159" is not a valid SA number → rejected, never silently accepted.
    expect(resolveAuthPhone(SAUDI, "98115159")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
  });
});

describe("canRequestOtp — the submit gate", () => {
  it("true for a valid number under any supported country", () => {
    expect(canRequestOtp(OMAN, "98115159")).toBe(true);
    expect(canRequestOtp(UAE, "501234567")).toBe(true);
  });

  it("false for an invalid number", () => {
    expect(canRequestOtp(OMAN, "12")).toBe(false);
    expect(canRequestOtp(UK, "12")).toBe(false);
  });
});
