import { describe, it, expect } from "vitest";
import { isVerificationEditableStatus, canMutateVerificationDocument } from "./verification-lifecycle";

// Gate 1B — the single source of truth for "may the provider edit + (re)submit".
describe("isVerificationEditableStatus", () => {
  it("is TRUE only for DRAFT and CHANGES_REQUESTED", () => {
    expect(isVerificationEditableStatus("DRAFT")).toBe(true);
    expect(isVerificationEditableStatus("CHANGES_REQUESTED")).toBe(true);
  });

  it.each(["APPLIED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "DEACTIVATED"])(
    "is FALSE for %s (document mutation + submit are locked)",
    (status) => {
      expect(isVerificationEditableStatus(status)).toBe(false);
    }
  );
});

// Targeted fix — the server document-mutation policy matrix.
describe("canMutateVerificationDocument", () => {
  const can = (o: {
    providerStatus: string;
    requirementRequired: boolean;
    documentExists: boolean;
    mutationType: "upload" | "replace" | "delete";
  }) => canMutateVerificationDocument(o);

  it.each(["DRAFT", "CHANGES_REQUESTED"])("%s: every mutation allowed (fully editable)", (providerStatus) => {
    for (const mutationType of ["upload", "replace", "delete"] as const) {
      for (const requirementRequired of [true, false]) {
        for (const documentExists of [true, false]) {
          expect(can({ providerStatus, requirementRequired, documentExists, mutationType })).toBe(true);
        }
      }
    }
  });

  it.each(["UNDER_REVIEW", "APPLIED"])(
    "%s (submitted/locked): only the FIRST upload of an OPTIONAL missing requirement is allowed",
    (providerStatus) => {
      // The one allowed case:
      expect(can({ providerStatus, requirementRequired: false, documentExists: false, mutationType: "upload" })).toBe(true);
      // Required + missing → denied
      expect(can({ providerStatus, requirementRequired: true, documentExists: false, mutationType: "upload" })).toBe(false);
      // Optional + exists → denied (no duplicate)
      expect(can({ providerStatus, requirementRequired: false, documentExists: true, mutationType: "upload" })).toBe(false);
      // Required + exists → denied
      expect(can({ providerStatus, requirementRequired: true, documentExists: true, mutationType: "upload" })).toBe(false);
      // Replace / Delete → always denied, even optional+existing
      for (const documentExists of [true, false]) {
        expect(can({ providerStatus, requirementRequired: false, documentExists, mutationType: "replace" })).toBe(false);
        expect(can({ providerStatus, requirementRequired: false, documentExists, mutationType: "delete" })).toBe(false);
      }
    }
  );

  it.each(["APPROVED", "REJECTED", "SUSPENDED", "DEACTIVATED"])("%s: all mutation denied", (providerStatus) => {
    for (const mutationType of ["upload", "replace", "delete"] as const) {
      expect(can({ providerStatus, requirementRequired: false, documentExists: false, mutationType })).toBe(false);
    }
  });
});
