import { describe, it, expect } from "vitest";
import {
  ASSET_DOCUMENT_TYPE_KEYS,
  isValidAssetDocumentTypeKey,
  requiredAssetDocumentTypesFor,
} from "./asset-document-types";

describe("asset-document-types registry (code-owned, product policy)", () => {
  it("validates only the governed keys", () => {
    expect(isValidAssetDocumentTypeKey("VEHICLE_REGISTRATION")).toBe(true);
    expect(isValidAssetDocumentTypeKey("VEHICLE_INSURANCE")).toBe(true);
    expect(isValidAssetDocumentTypeKey("PASSPORT")).toBe(false);
    expect(isValidAssetDocumentTypeKey(123)).toBe(false);
  });

  it("declares the VEHICLE required set (registration + insurance)", () => {
    expect(requiredAssetDocumentTypesFor("VEHICLE").sort()).toEqual(["VEHICLE_INSURANCE", "VEHICLE_REGISTRATION"]);
  });

  it("returns a fresh array (callers can't mutate the registry)", () => {
    const a = requiredAssetDocumentTypesFor("VEHICLE");
    a.push("X" as never);
    expect(requiredAssetDocumentTypesFor("VEHICLE")).toHaveLength(2);
  });

  it("keys are exactly the two product evidence categories", () => {
    expect([...ASSET_DOCUMENT_TYPE_KEYS]).toEqual(["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"]);
  });
});
