import { describe, it, expect } from "vitest";
import { resolveAuthPhone, canRequestOtp } from "./phone-entry";
import { DEFAULT_COUNTRY, findCountryByIso, COUNTRIES } from "@/lib/countries/registry";

const OMAN = DEFAULT_COUNTRY; // OM, authSupported: true
const GERMANY = findCountryByIso("DE")!; // authSupported: false

describe("registry — Oman is the only auth-supported country", () => {
  it("Oman is present, is the default, and is auth-supported", () => {
    expect(OMAN.iso).toBe("OM");
    expect(OMAN.callingCode).toBe("+968");
    expect(OMAN.authSupported).toBe(true);
  });

  it("EXACTLY one country is auth-supported (Oman)", () => {
    const supported = COUNTRIES.filter((c) => c.authSupported);
    expect(supported).toHaveLength(1);
    expect(supported[0]!.iso).toBe("OM");
  });
});

describe("resolveAuthPhone — Oman produces the P0-1 canonical identity", () => {
  it("a local Oman number becomes the existing canonical +968XXXXXXXX", () => {
    expect(resolveAuthPhone(OMAN, "98115159")).toEqual({ ok: true, e164: "+96898115159" });
  });

  it("all P0-1-accepted Oman input forms converge to ONE canonical identity (no fragmentation)", () => {
    const forms = ["98115159", "+96898115159", "96898115159", "0096898115159", "+968 9811 5159"];
    const results = new Set(
      forms.map((f) => {
        const r = resolveAuthPhone(OMAN, f);
        return r.ok ? r.e164 : `REJECTED`;
      })
    );
    expect(results.size).toBe(1);
    expect([...results][0]).toBe("+96898115159");
  });

  it("rejects an invalid Oman number without pretending success", () => {
    expect(resolveAuthPhone(OMAN, "123")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
    expect(resolveAuthPhone(OMAN, "")).toEqual({ ok: false, reason: "INVALID_NUMBER" });
  });
});

describe("resolveAuthPhone — unsupported countries can NEVER produce a sendable number", () => {
  it("an unsupported country is rejected as COUNTRY_UNSUPPORTED (never coerced to Oman)", () => {
    expect(resolveAuthPhone(GERMANY, "15123456789")).toEqual({ ok: false, reason: "COUNTRY_UNSUPPORTED" });
    // even a string that looks like a valid Oman number is NOT silently accepted
    // for a non-Oman country selection.
    expect(resolveAuthPhone(GERMANY, "98115159")).toEqual({ ok: false, reason: "COUNTRY_UNSUPPORTED" });
  });
});

describe("canRequestOtp — the submit gate", () => {
  it("true only for a valid Oman number under a supported country", () => {
    expect(canRequestOtp(OMAN, "98115159")).toBe(true);
  });

  it("false for an unsupported country (blocks send-otp)", () => {
    expect(canRequestOtp(GERMANY, "98115159")).toBe(false);
  });

  it("false for an invalid Oman number", () => {
    expect(canRequestOtp(OMAN, "12")).toBe(false);
  });
});
