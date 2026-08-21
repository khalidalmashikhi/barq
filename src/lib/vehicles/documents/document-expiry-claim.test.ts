import { describe, it, expect } from "vitest";
import { parseClaimedExpiryDate } from "./document-expiry-claim";
import { assetDocumentTypeSupportsExpiry } from "./asset-document-types";

// VEHICLE-LC6 — the provider-claimed expiry date is ADVISORY and strictly validated.
const EXPIRING = "VEHICLE_REGISTRATION";
const NON_EXPIRING = "SOME_OTHER_DOC"; // not in the expiry-supporting set

describe("assetDocumentTypeSupportsExpiry", () => {
  it("registration and insurance support expiry; unknown/other types do not", () => {
    expect(assetDocumentTypeSupportsExpiry("VEHICLE_REGISTRATION")).toBe(true);
    expect(assetDocumentTypeSupportsExpiry("VEHICLE_INSURANCE")).toBe(true);
    expect(assetDocumentTypeSupportsExpiry("SOME_OTHER_DOC")).toBe(false);
    expect(assetDocumentTypeSupportsExpiry("")).toBe(false);
  });
});

describe("parseClaimedExpiryDate", () => {
  it("accepts an absent/empty claim as null (optional)", () => {
    expect(parseClaimedExpiryDate(EXPIRING, null)).toEqual({ ok: true, value: null });
    expect(parseClaimedExpiryDate(EXPIRING, undefined)).toEqual({ ok: true, value: null });
    expect(parseClaimedExpiryDate(EXPIRING, "")).toEqual({ ok: true, value: null });
    expect(parseClaimedExpiryDate(EXPIRING, "   ")).toEqual({ ok: true, value: null });
  });

  it("accepts a well-formed real date for an expiry-supporting type", () => {
    expect(parseClaimedExpiryDate(EXPIRING, "2027-05-31")).toEqual({ ok: true, value: "2027-05-31" });
    expect(parseClaimedExpiryDate(EXPIRING, " 2028-02-29 ")).toEqual({ ok: true, value: "2028-02-29" }); // leap day, trimmed
  });

  it("rejects malformed / impossible dates", () => {
    for (const bad of ["2027-13-01", "2027-02-30", "2027-5-31", "05/31/2027", "2027-05-31T00:00", "nope"]) {
      expect(parseClaimedExpiryDate(EXPIRING, bad)).toEqual({ ok: false });
    }
  });

  it("rejects a non-string claim", () => {
    expect(parseClaimedExpiryDate(EXPIRING, 20270531 as unknown)).toEqual({ ok: false });
  });

  it("DROPS a claim for a NON-expiring type to null (centralized policy, not an error)", () => {
    expect(parseClaimedExpiryDate(NON_EXPIRING, "2027-05-31")).toEqual({ ok: true, value: null });
  });
});
