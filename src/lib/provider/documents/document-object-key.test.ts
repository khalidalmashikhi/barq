import { describe, it, expect } from "vitest";
import { buildDocumentObjectKey, sanitizeOriginalFilename } from "./document-object-key";

describe("buildDocumentObjectKey", () => {
  it("produces a private, provider-scoped, uuid-based key (never the filename)", () => {
    const key = buildDocumentObjectKey({ providerId: "prov-1", type: "COMMERCIAL_REGISTRATION", ext: "pdf", unique: "abc-123" });
    expect(key).toBe("provider-documents/prov-1/commercial_registration/abc-123.pdf");
  });

  it("lowercases the type segment and never embeds a caller filename", () => {
    const key = buildDocumentObjectKey({ providerId: "p", type: "IDENTITY_PROOF", ext: "jpg", unique: "u" });
    expect(key).toBe("provider-documents/p/identity_proof/u.jpg");
    expect(key).not.toContain("..");
  });
});

describe("sanitizeOriginalFilename", () => {
  it("strips path separators so a filename cannot influence any path", () => {
    expect(sanitizeOriginalFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeOriginalFilename("a\\b\\c.pdf")).not.toContain("\\");
  });

  it("removes control characters (e.g. a tab)", () => {
    const tab = String.fromCharCode(9);
    expect(sanitizeOriginalFilename("my" + tab + "doc.pdf")).toBe("mydoc.pdf");
  });

  it("collapses runs of whitespace to a single space", () => {
    expect(sanitizeOriginalFilename("my    doc   name.pdf")).toBe("my doc name.pdf");
  });

  it("falls back to a safe default when empty after cleaning", () => {
    expect(sanitizeOriginalFilename("///")).toBe("___");
    expect(sanitizeOriginalFilename("   ")).toBe("document");
    expect(sanitizeOriginalFilename("")).toBe("document");
  });

  it("caps length", () => {
    expect(sanitizeOriginalFilename("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});
