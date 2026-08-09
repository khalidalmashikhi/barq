import { describe, it, expect } from "vitest";
import {
  PROVIDER_DOCUMENT_TYPE_KEYS,
  PROVIDER_DOCUMENT_TYPE_LABEL_KEYS,
  isValidProviderDocumentTypeKey,
} from "./registry";

// Provider document-type registry — mirrors service-types/registry.test.ts.
// Pins the governed key set, the exhaustive label mapping, and the validator
// that is the SOLE guard on ProviderDocument.type (no DB CHECK exists).

describe("provider-document-types registry", () => {
  it("exposes exactly the frozen Gate-1 keys, all unique", () => {
    expect([...PROVIDER_DOCUMENT_TYPE_KEYS]).toEqual([
      "IDENTITY_PROOF",
      "COMMERCIAL_REGISTRATION",
      "TOURISM_LICENCE",
    ]);
    expect(new Set(PROVIDER_DOCUMENT_TYPE_KEYS).size).toBe(PROVIDER_DOCUMENT_TYPE_KEYS.length);
  });

  it("has an exhaustive label-key mapping (one per key, all unique)", () => {
    expect(Object.keys(PROVIDER_DOCUMENT_TYPE_LABEL_KEYS).sort()).toEqual([...PROVIDER_DOCUMENT_TYPE_KEYS].sort());
    const labels = Object.values(PROVIDER_DOCUMENT_TYPE_LABEL_KEYS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("validator accepts every known key", () => {
    for (const key of PROVIDER_DOCUMENT_TYPE_KEYS) {
      expect(isValidProviderDocumentTypeKey(key)).toBe(true);
    }
  });

  it("validator rejects unknown / malformed values (the only guard on .type)", () => {
    for (const bad of [
      "identity_proof",
      "PASSPORT",
      "",
      "  ",
      "COMMERCIAL_REGISTRATION ",
      null,
      undefined,
      5,
      {},
      ["IDENTITY_PROOF"],
    ]) {
      expect(isValidProviderDocumentTypeKey(bad)).toBe(false);
    }
  });
});
