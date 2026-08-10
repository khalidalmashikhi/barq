import { describe, it, expect } from "vitest";
import { validateImageUpload, MAX_IMAGE_BYTES } from "./media-constants";

// Media Foundation (Gap C) — validation rules for uploaded images. Pure,
// so exhaustively unit-testable with no mocks.

describe("MAX_IMAGE_BYTES", () => {
  it("is 4 MiB — aligned with the ~4.5 MB Vercel request-body ceiling", () => {
    expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("validateImageUpload", () => {
  it("accepts jpeg/png/webp and returns the canonical extension", () => {
    expect(validateImageUpload({ type: "image/jpeg", size: 1000 })).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      ext: "jpg",
    });
    expect(validateImageUpload({ type: "image/png", size: 1000 })).toEqual({
      ok: true,
      mimeType: "image/png",
      ext: "png",
    });
    expect(validateImageUpload({ type: "image/webp", size: 1000 })).toEqual({
      ok: true,
      mimeType: "image/webp",
      ext: "webp",
    });
  });

  it("rejects an empty file", () => {
    expect(validateImageUpload({ type: "image/png", size: 0 })).toEqual({ ok: false, error: "EMPTY_FILE" });
  });

  it("rejects a file over the size limit", () => {
    expect(validateImageUpload({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateImageUpload({ type: "image/png", size: MAX_IMAGE_BYTES }).ok).toBe(true);
  });

  it("rejects a disallowed MIME type (incl. SVG, an XSS vector)", () => {
    for (const type of ["image/svg+xml", "image/gif", "application/pdf", "text/html", ""]) {
      expect(validateImageUpload({ type, size: 1000 })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    }
  });

  it("checks size before type (empty/oversize win over an unknown type)", () => {
    expect(validateImageUpload({ type: "application/zip", size: 0 })).toEqual({ ok: false, error: "EMPTY_FILE" });
    expect(validateImageUpload({ type: "application/zip", size: MAX_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
  });
});
