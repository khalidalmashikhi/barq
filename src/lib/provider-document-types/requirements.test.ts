import { describe, it, expect } from "vitest";
import type { ProviderType } from "@prisma/client";
import { requiredDocumentTypesFor, resolveRequiredDocumentBlockers, resolveSubmitBlockers, resolveVerticalDocumentBlockers } from "./requirements";

// Provider document REQUIREMENT rules + the pure completeness primitive that the
// future assertProviderApprovable() gate will consume. Requirements key ONLY on
// ProviderType (no public Category dependency); TOURISM_LICENCE is recognized
// but never a universal MVP blocker.

describe("requiredDocumentTypesFor", () => {
  it("INDIVIDUAL requires identity evidence only", () => {
    expect(requiredDocumentTypesFor({ providerType: "INDIVIDUAL" })).toEqual(["IDENTITY_PROOF"]);
  });

  it("COMPANY requires business-registration evidence only", () => {
    expect(requiredDocumentTypesFor({ providerType: "COMPANY" })).toEqual(["COMMERCIAL_REGISTRATION"]);
  });

  it("never requires TOURISM_LICENCE for any provider type (recognized, not a universal blocker)", () => {
    for (const providerType of ["INDIVIDUAL", "COMPANY"] as ProviderType[]) {
      expect(requiredDocumentTypesFor({ providerType })).not.toContain("TOURISM_LICENCE");
    }
  });

  it("is deterministic and returns a fresh (mutation-safe) array each call", () => {
    const a = requiredDocumentTypesFor({ providerType: "COMPANY" });
    const b = requiredDocumentTypesFor({ providerType: "COMPANY" });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.push("TOURISM_LICENCE");
    expect(requiredDocumentTypesFor({ providerType: "COMPANY" })).toEqual(["COMMERCIAL_REGISTRATION"]);
  });

  it("depends only on providerType — ignores any other (e.g. category) context", () => {
    // Extra fields must not change the result: requirements never consult the
    // public Category taxonomy.
    const withNoise = requiredDocumentTypesFor({
      providerType: "COMPANY",
      // @ts-expect-error — categories are intentionally NOT part of the contract
      categoryIds: ["x", "y"],
    });
    expect(withNoise).toEqual(["COMMERCIAL_REGISTRATION"]);
  });
});

describe("resolveRequiredDocumentBlockers (pure completeness primitive)", () => {
  const required = ["COMMERCIAL_REGISTRATION"] as const;

  it("required + APPROVED → no blockers", () => {
    expect(resolveRequiredDocumentBlockers(required, [{ type: "COMMERCIAL_REGISTRATION", status: "APPROVED" }])).toEqual([]);
  });

  it("required + missing → MISSING blocker", () => {
    expect(resolveRequiredDocumentBlockers(required, [])).toEqual([{ type: "COMMERCIAL_REGISTRATION", reason: "MISSING" }]);
  });

  it("required + PENDING → NOT_APPROVED blocker", () => {
    expect(resolveRequiredDocumentBlockers(required, [{ type: "COMMERCIAL_REGISTRATION", status: "PENDING" }])).toEqual([
      { type: "COMMERCIAL_REGISTRATION", reason: "NOT_APPROVED" },
    ]);
  });

  it("required + REJECTED → NOT_APPROVED blocker", () => {
    expect(resolveRequiredDocumentBlockers(required, [{ type: "COMMERCIAL_REGISTRATION", status: "REJECTED" }])).toEqual([
      { type: "COMMERCIAL_REGISTRATION", reason: "NOT_APPROVED" },
    ]);
  });

  it("an optional (non-required) document never blocks", () => {
    // Provider uploaded a TOURISM_LICENCE (optional) but is missing the required CR.
    expect(
      resolveRequiredDocumentBlockers(required, [{ type: "TOURISM_LICENCE", status: "PENDING" }])
    ).toEqual([{ type: "COMMERCIAL_REGISTRATION", reason: "MISSING" }]);
  });

  it("returns blockers in required-type order (mirrors assertServicePublishable)", () => {
    const multi = ["IDENTITY_PROOF", "COMMERCIAL_REGISTRATION"] as const;
    expect(
      resolveRequiredDocumentBlockers(multi, [{ type: "COMMERCIAL_REGISTRATION", status: "PENDING" }])
    ).toEqual([
      { type: "IDENTITY_PROOF", reason: "MISSING" },
      { type: "COMMERCIAL_REGISTRATION", reason: "NOT_APPROVED" },
    ]);
  });

  it("empty required set → never blocks", () => {
    expect(resolveRequiredDocumentBlockers([], [{ type: "COMMERCIAL_REGISTRATION", status: "REJECTED" }])).toEqual([]);
  });
});

describe("resolveSubmitBlockers — Gate 1A presence-only submit readiness", () => {
  const required = ["IDENTITY_PROOF"] as const;

  it("a PENDING document satisfies submission (unlike the APPROVAL gate)", () => {
    expect(resolveSubmitBlockers(required, [{ type: "IDENTITY_PROOF", status: "PENDING" }])).toEqual([]);
  });

  it("an APPROVED document satisfies submission", () => {
    expect(resolveSubmitBlockers(required, [{ type: "IDENTITY_PROOF", status: "APPROVED" }])).toEqual([]);
  });

  it("a MISSING required document blocks submission", () => {
    expect(resolveSubmitBlockers(required, [])).toEqual([{ type: "IDENTITY_PROOF", reason: "MISSING" }]);
  });

  it("an admin-REJECTED document blocks submission (must be replaced first)", () => {
    expect(resolveSubmitBlockers(required, [{ type: "IDENTITY_PROOF", status: "REJECTED" }])).toEqual([
      { type: "IDENTITY_PROOF", reason: "REJECTED" },
    ]);
  });

  it("optional documents never block submission", () => {
    expect(
      resolveSubmitBlockers(required, [
        { type: "IDENTITY_PROOF", status: "PENDING" },
        { type: "TOURISM_LICENCE", status: "REJECTED" },
      ])
    ).toEqual([]);
  });

  it("differs from the approval gate: PENDING blocks approval but NOT submission", () => {
    const docs = [{ type: "IDENTITY_PROOF", status: "PENDING" as const }];
    expect(resolveRequiredDocumentBlockers(required, docs)).toEqual([{ type: "IDENTITY_PROOF", reason: "NOT_APPROVED" }]);
    expect(resolveSubmitBlockers(required, docs)).toEqual([]);
  });
});

describe("resolveVerticalDocumentBlockers (Phase 3B — expiry-aware compliance)", () => {
  const NOW = new Date("2026-09-11T00:00:00.000Z");
  const FUTURE = new Date("2027-01-01T00:00:00.000Z");
  const PAST = new Date("2026-01-01T00:00:00.000Z");
  const REQ_EXPIRING = [{ key: "TOURIST_GUIDE_LICENCE", evidenceExpires: true }];
  const REQ_NON_EXPIRING = [{ key: "TOURIST_GUIDE_LICENCE", evidenceExpires: false }];

  it("empty required set → no blockers (the caller decides POLICY_NOT_CONFIGURED separately)", () => {
    expect(resolveVerticalDocumentBlockers([], [], NOW)).toEqual([]);
  });

  it("MISSING when no document exists for the required key", () => {
    expect(resolveVerticalDocumentBlockers(REQ_NON_EXPIRING, [], NOW)).toEqual([
      { type: "TOURIST_GUIDE_LICENCE", reason: "MISSING" },
    ]);
  });

  it("NOT_APPROVED for a PENDING or REJECTED document", () => {
    expect(resolveVerticalDocumentBlockers(REQ_NON_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "PENDING" }], NOW)).toEqual([
      { type: "TOURIST_GUIDE_LICENCE", reason: "NOT_APPROVED" },
    ]);
    expect(resolveVerticalDocumentBlockers(REQ_NON_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "REJECTED" }], NOW)).toEqual([
      { type: "TOURIST_GUIDE_LICENCE", reason: "NOT_APPROVED" },
    ]);
  });

  it("a non-expiring requirement with an APPROVED doc has NO blockers (expiry ignored)", () => {
    expect(
      resolveVerticalDocumentBlockers(REQ_NON_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: null }], NOW)
    ).toEqual([]);
  });

  it("EXPIRY_MISSING when an expiring requirement's APPROVED doc has no expiry", () => {
    expect(
      resolveVerticalDocumentBlockers(REQ_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: null }], NOW)
    ).toEqual([{ type: "TOURIST_GUIDE_LICENCE", reason: "EXPIRY_MISSING" }]);
  });

  it("EXPIRED when the expiry is at or before now; VALID when in the future", () => {
    expect(
      resolveVerticalDocumentBlockers(REQ_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: PAST }], NOW)
    ).toEqual([{ type: "TOURIST_GUIDE_LICENCE", reason: "EXPIRED" }]);
    expect(
      resolveVerticalDocumentBlockers(REQ_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: NOW }], NOW)
    ).toEqual([{ type: "TOURIST_GUIDE_LICENCE", reason: "EXPIRED" }]); // <= now is expired
    expect(
      resolveVerticalDocumentBlockers(REQ_EXPIRING, [{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: FUTURE }], NOW)
    ).toEqual([]);
  });
});
