import { describe, it, expect } from "vitest";
import { isRequiredDocumentRemediable } from "./document-remediation";

// VEHICLE-LC5 — full truth table for the narrow remediation exception. The point of
// these pins is the loophole-prevention proof: the ONLY document that becomes
// mutable under an APPROVED vehicle is an expired-APPROVED or REJECTED REQUIRED
// document. Everything else — a valid approved doc, a PENDING doc, an optional doc,
// any non-APPROVED verification — stays locked.

const REQUIRED = ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"] as const;
const PAST = new Date("2000-01-01T00:00:00Z");
const FUTURE = new Date("2999-01-01T00:00:00Z");
const NOW = new Date("2026-01-01T00:00:00Z");

const input = (over: Partial<Parameters<typeof isRequiredDocumentRemediable>[0]>) =>
  isRequiredDocumentRemediable({
    verificationStatus: "APPROVED",
    documentType: "VEHICLE_REGISTRATION",
    requiredTypes: REQUIRED,
    documentStatus: "APPROVED",
    expiresAt: PAST,
    now: NOW,
    ...over,
  });

describe("isRequiredDocumentRemediable", () => {
  it("REMEDIABLE: APPROVED vehicle + expired APPROVED required document", () => {
    expect(input({ documentStatus: "APPROVED", expiresAt: PAST })).toBe(true);
  });

  it("LOCKED: APPROVED vehicle + valid (unexpired) APPROVED required document — no arbitrary editing", () => {
    expect(input({ documentStatus: "APPROVED", expiresAt: FUTURE })).toBe(false);
    expect(input({ documentStatus: "APPROVED", expiresAt: null })).toBe(false); // never-expires
  });

  it("REMEDIABLE: APPROVED vehicle + REJECTED required document (an LC5 retry)", () => {
    expect(input({ documentStatus: "REJECTED", expiresAt: null })).toBe(true);
    expect(input({ documentStatus: "REJECTED", expiresAt: PAST })).toBe(true);
  });

  it("LOCKED: APPROVED vehicle + PENDING document — fail-closed while in the admin's hands", () => {
    expect(input({ documentStatus: "PENDING", expiresAt: PAST })).toBe(false);
    expect(input({ documentStatus: "PENDING", expiresAt: null })).toBe(false);
  });

  it("LOCKED: an expired APPROVED but NON-required (optional) document", () => {
    expect(input({ documentType: "SOME_OPTIONAL_DOC", documentStatus: "APPROVED", expiresAt: PAST })).toBe(false);
  });

  it("LOCKED: any non-APPROVED verification state defers to the LC2 rules", () => {
    for (const verificationStatus of ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED"] as const) {
      expect(input({ verificationStatus, documentStatus: "APPROVED", expiresAt: PAST })).toBe(false);
      expect(input({ verificationStatus, documentStatus: "REJECTED" })).toBe(false);
    }
  });

  it("expiry boundary is inclusive (expiresAt === now counts as expired)", () => {
    expect(input({ documentStatus: "APPROVED", expiresAt: NOW, now: NOW })).toBe(true);
  });
});
