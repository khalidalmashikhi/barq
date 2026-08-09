import { describe, it, expect } from "vitest";
import type { ProviderType } from "@prisma/client";
import { requiredDocumentTypesFor, resolveRequiredDocumentBlockers } from "./requirements";

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
