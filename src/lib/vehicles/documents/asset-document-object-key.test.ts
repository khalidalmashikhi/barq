import { describe, it, expect } from "vitest";
import { buildAssetDocumentObjectKey, sanitizeOriginalFilename } from "./asset-document-object-key";

describe("buildAssetDocumentObjectKey", () => {
  it("namespaces under asset-documents/{assetId}/{type-lowercased}/{unique}.{ext}", () => {
    const key = buildAssetDocumentObjectKey({ assetId: "asset-1", type: "VEHICLE_REGISTRATION", ext: "pdf", unique: "u-9" });
    expect(key).toBe("asset-documents/asset-1/vehicle_registration/u-9.pdf");
  });

  it("re-exports the shared filename sanitizer (strips path separators for downloads)", () => {
    expect(typeof sanitizeOriginalFilename).toBe("function");
    const out = sanitizeOriginalFilename("../../etc/passwd");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
  });
});
