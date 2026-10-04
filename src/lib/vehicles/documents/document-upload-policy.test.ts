import { describe, it, expect } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@/lib/provider/documents/document-constants";
import {
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_PIXELS,
  NORMALIZED_IMAGE_MAX_EDGE,
  NORMALIZED_IMAGE_TARGET_BYTES,
  NORMALIZATION_STEPS,
  CLIENT_MAX_SOURCE_BYTES,
  CLIENT_UPLOAD_TARGET_BYTES,
  CLIENT_DOWNSIZE_STEPS,
  isHeicSignature,
  fitWithin,
} from "./document-upload-policy";
import { planUpload } from "./client-upload-file";
import { isoBmffHeader } from "./synthetic-test-documents";

const head = (bytes: number[], pad = 32) => {
  const out = new Uint8Array(pad);
  out.set(bytes);
  return out;
};
const JPEG = head([0xff, 0xd8, 0xff, 0xe0]);
const PNG = head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = head([0x25, 0x50, 0x44, 0x46, 0x2d]);
const WEBP = head([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const HEIC = new Uint8Array(isoBmffHeader("heic"));
const MiB = 1024 * 1024;

describe("upload policy — the two limits are real and consistent", () => {
  it("the absolute ceiling is the platform-bound 4 MiB (below the ~4.5 MB function request limit)", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_DOCUMENT_BYTES);
    expect(MAX_UPLOAD_BYTES).toBe(4 * MiB);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1000 * 1000);
  });

  it("the normalized target sits below the ceiling; the browser target leaves room for multipart framing", () => {
    expect(NORMALIZED_IMAGE_TARGET_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(CLIENT_UPLOAD_TARGET_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(MAX_UPLOAD_BYTES - CLIENT_UPLOAD_TARGET_BYTES).toBeGreaterThanOrEqual(256 * 1024);
    expect(CLIENT_MAX_SOURCE_BYTES).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });

  it("every normalization step stays within the max edge, and steps only ever get smaller", () => {
    expect(NORMALIZATION_STEPS[0]!.edge).toBe(NORMALIZED_IMAGE_MAX_EDGE);
    for (const steps of [NORMALIZATION_STEPS, CLIENT_DOWNSIZE_STEPS]) {
      for (let i = 0; i < steps.length; i++) {
        expect(steps[i]!.edge).toBeLessThanOrEqual(NORMALIZED_IMAGE_MAX_EDGE);
        if (i > 0) {
          expect(steps[i]!.edge).toBeLessThanOrEqual(steps[i - 1]!.edge);
          expect(steps[i]!.quality).toBeLessThanOrEqual(steps[i - 1]!.quality);
        }
      }
    }
  });

  it("the pixel guard admits current phone sensors (48 MP) and refuses beyond 50 MP", () => {
    expect(8064 * 6048).toBeLessThanOrEqual(MAX_IMAGE_PIXELS); // 48.8 MP
    expect(MAX_IMAGE_PIXELS).toBe(50_000_000);
  });
});

describe("isHeicSignature", () => {
  it.each(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"])("recognizes ftyp brand %s", (brand) => {
    expect(isHeicSignature(new Uint8Array(isoBmffHeader(brand)))).toBe(true);
  });

  it.each(["avif", "mp42", "isom", "qt  ", "M4V "])("does not flag the non-HEIC container brand %s", (brand) => {
    expect(isHeicSignature(new Uint8Array(isoBmffHeader(brand)))).toBe(false);
  });

  it("never flags JPEG / PNG / PDF / WebP / empty / short input", () => {
    for (const bytes of [JPEG, PNG, PDF, WEBP, new Uint8Array(0), new Uint8Array(8)]) expect(isHeicSignature(bytes)).toBe(false);
  });
});

describe("fitWithin", () => {
  it("never enlarges", () => {
    expect(fitWithin(800, 600, 3000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3000, 2000, 3000)).toEqual({ width: 3000, height: 2000 });
  });
  it("scales the long edge to the limit and keeps the aspect ratio (landscape and portrait)", () => {
    expect(fitWithin(6000, 4000, 3000)).toEqual({ width: 3000, height: 2000 });
    expect(fitWithin(3024, 4032, 3000)).toEqual({ width: 2250, height: 3000 });
  });
  it("never returns a zero dimension for an extreme aspect ratio", () => {
    expect(fitWithin(100000, 1, 3000)).toEqual({ width: 3000, height: 1 });
  });
});

describe("planUpload — what the browser does with a chosen file (decided by bytes, never by name)", () => {
  it("PDF: sent untouched when within the ceiling, refused when over (a PDF is never re-encoded)", () => {
    expect(planUpload(PDF, 1 * MiB)).toEqual({ action: "SEND_AS_IS", mimeType: "application/pdf" });
    expect(planUpload(PDF, MAX_UPLOAD_BYTES)).toEqual({ action: "SEND_AS_IS", mimeType: "application/pdf" });
    expect(planUpload(PDF, MAX_UPLOAD_BYTES + 1)).toEqual({ action: "REJECT", error: "TOO_LARGE" });
  });

  it("a small JPEG / PNG goes up as-is with the type proven by its signature", () => {
    expect(planUpload(JPEG, 2 * MiB)).toEqual({ action: "SEND_AS_IS", mimeType: "image/jpeg" });
    expect(planUpload(PNG, CLIENT_UPLOAD_TARGET_BYTES)).toEqual({ action: "SEND_AS_IS", mimeType: "image/png" });
  });

  it("an ordinary large phone photo (bigger than the request ceiling) is DOWNSIZED on the device, not refused", () => {
    expect(planUpload(JPEG, 8 * MiB)).toEqual({ action: "DOWNSIZE", isHeic: false });
    expect(planUpload(PNG, CLIENT_UPLOAD_TARGET_BYTES + 1)).toEqual({ action: "DOWNSIZE", isHeic: false });
    expect(planUpload(JPEG, CLIENT_MAX_SOURCE_BYTES)).toEqual({ action: "DOWNSIZE", isHeic: false });
  });

  it("an absurdly large image is refused outright", () => {
    expect(planUpload(JPEG, CLIENT_MAX_SOURCE_BYTES + 1)).toEqual({ action: "REJECT", error: "TOO_LARGE" });
  });

  it("HEIC is routed to on-device conversion and flagged, so an undecodable one gets the HEIC message", () => {
    expect(planUpload(HEIC, 3 * MiB)).toEqual({ action: "DOWNSIZE", isHeic: true });
    expect(planUpload(HEIC, 100)).toEqual({ action: "DOWNSIZE", isHeic: true }); // never sent raw: the server cannot decode it
  });

  it("WebP is re-encoded to JPEG on the device", () => {
    expect(planUpload(WEBP, 1 * MiB)).toEqual({ action: "DOWNSIZE", isHeic: false });
  });

  it("anything else is refused by content — a .jpg name on other bytes does not help", () => {
    for (const bytes of [head([0x47, 0x49, 0x46, 0x38]), head([0x50, 0x4b, 0x03, 0x04]), head([0x3c, 0x73, 0x76, 0x67]), head([0x4d, 0x5a]), new Uint8Array(isoBmffHeader("mp42"))]) {
      expect(planUpload(bytes, 1000)).toEqual({ action: "REJECT", error: "UNSUPPORTED_TYPE" });
    }
  });

  it("an empty file is refused", () => {
    expect(planUpload(new Uint8Array(0), 0)).toEqual({ action: "REJECT", error: "EMPTY_FILE" });
  });
});
