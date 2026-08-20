import { describe, it, expect } from "vitest";
import {
  ASSET_DOCUMENT_ERROR_CODES,
  isAssetDocumentErrorCode,
  getAssetDocumentErrorTranslationKey,
} from "./asset-document-errors";

describe("asset-document error codes", () => {
  it("guards valid codes and rejects everything else", () => {
    expect(isAssetDocumentErrorCode("ALREADY_EXISTS")).toBe(true);
    expect(isAssetDocumentErrorCode("LOCKED")).toBe(true);
    expect(isAssetDocumentErrorCode("__nope__")).toBe(false);
    expect(isAssetDocumentErrorCode(undefined)).toBe(false);
    expect(isAssetDocumentErrorCode(42)).toBe(false);
  });

  it("maps every code to a non-empty provider translation key (totality)", () => {
    for (const code of ASSET_DOCUMENT_ERROR_CODES) {
      const key = getAssetDocumentErrorTranslationKey(code);
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("maps distinct file-safety codes to distinct keys", () => {
    const keys = new Set(ASSET_DOCUMENT_ERROR_CODES.map(getAssetDocumentErrorTranslationKey));
    // No accidental collisions that would show the wrong message.
    expect(keys.size).toBe(ASSET_DOCUMENT_ERROR_CODES.length);
  });
});
