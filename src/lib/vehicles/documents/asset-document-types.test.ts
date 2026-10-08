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

  it("the optional back side is a governed key but NEVER a required or expiring document", () => {
    expect(isValidAssetDocumentTypeKey("VEHICLE_REGISTRATION_BACK")).toBe(true);
    expect(requiredAssetDocumentTypesFor("VEHICLE")).not.toContain("VEHICLE_REGISTRATION_BACK");
  });

  it("keys are exactly the product evidence categories (registration front/PDF, its optional back side, insurance)", () => {
    expect([...ASSET_DOCUMENT_TYPE_KEYS]).toEqual(["VEHICLE_REGISTRATION", "VEHICLE_REGISTRATION_BACK", "VEHICLE_INSURANCE"]);
  });
});
