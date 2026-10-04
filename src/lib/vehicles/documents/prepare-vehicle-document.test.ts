import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { buildSyntheticPdf, buildEncryptedPdf, isoBmffHeader, SYNTHETIC_REGISTRATION_LINES } from "./synthetic-test-documents";
import { MAX_UPLOAD_BYTES, MAX_IMAGE_PIXELS, NORMALIZED_IMAGE_MAX_EDGE, NORMALIZED_IMAGE_TARGET_BYTES } from "./document-upload-policy";

// The REAL decoder (sharp/libvips) and the REAL bounded PDF parser run here — nothing is mocked but
// `server-only`. Every image and PDF is synthetic, generated in-process: no real registration
// document, plate, VIN or person exists in this suite.

vi.mock("server-only", () => ({}));
// Real image decoding and the first load of the PDF engine are slow when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const { prepareVehicleDocumentForStorage } = await import("./prepare-vehicle-document");

const ab = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background: channels === 4 ? { r: 10, g: 120, b: 200, alpha: 0.4 } : { r: 10, g: 120, b: 200 } } });
const noise = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 70 } } });

async function stored(result: Awaited<ReturnType<typeof prepareVehicleDocumentForStorage>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  const buf = Buffer.from(result.bytes);
  return { result, buf, meta: await sharp(buf).metadata() };
}

describe("prepareVehicleDocumentForStorage — accepted formats", () => {
  it("JPEG → stored as a re-encoded JPEG", async () => {
    const input = await solid(800, 600).jpeg().toBuffer();
    const { result, meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) }));
    expect(result).toMatchObject({ ok: true, mimeType: "image/jpeg", ext: "jpg", normalized: true });
    expect(meta).toMatchObject({ format: "jpeg", width: 800, height: 600 });
  });

  it("PNG (with transparency) → flattened and stored as JPEG, dimensions kept", async () => {
    const input = await solid(640, 480, 4).png().toBuffer();
    const { result, meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/png", bytes: ab(input) }));
    expect(result).toMatchObject({ mimeType: "image/jpeg", ext: "jpg", normalized: true });
    expect(meta).toMatchObject({ format: "jpeg", width: 640, height: 480 });
    expect(meta.hasAlpha).toBe(false);
  });

  it("WebP → stored as JPEG (one predictable stored image format)", async () => {
    const input = await solid(500, 300).webp().toBuffer();
    const { meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/webp", bytes: ab(input) }));
    expect(meta).toMatchObject({ format: "jpeg", width: 500, height: 300 });
  });

  it("a small image is NEVER enlarged", async () => {
    const input = await solid(120, 80).jpeg().toBuffer();
    const { meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) }));
    expect(meta).toMatchObject({ width: 120, height: 80 });
  });

  it("native-text PDF → stored byte-for-byte unchanged (never rasterized)", async () => {
    const bytes = buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]);
    const result = await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes });
    const original = Buffer.from(bytes.slice(0));
    expect(result).toMatchObject({ ok: true, mimeType: "application/pdf", ext: "pdf", normalized: false });
    if (!result.ok) return;
    expect(result.bytes).toBe(bytes);
    // REGRESSION: the structural check must not consume the buffer (the PDF engine detaches what it
    // is given) — otherwise an EMPTY object would be stored.
    expect(result.bytes.byteLength).toBe(original.byteLength);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(result.bytes).equals(original)).toBe(true);
  });

  it.each([
    ["blank scan", () => buildSyntheticPdf([null])],
    ["multi-page", () => buildSyntheticPdf([["one"], ["two"], null])],
  ])("a %s registration PDF keeps its full bytes through the structural check", async (_label, make) => {
    const bytes = make();
    const size = bytes.byteLength;
    const result = await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes });
    expect(result.ok && result.bytes.byteLength).toBe(size);
  });

  it("a scanned PDF with no text layer is accepted (it goes to manual review)", async () => {
    const result = await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: buildSyntheticPdf([null]) });
    expect(result.ok).toBe(true);
  });
});

describe("prepareVehicleDocumentForStorage — signature, never extension or declared type", () => {
  it("a PDF declared as a JPEG (renamed) is rejected", async () => {
    const result = await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: buildSyntheticPdf([["x"]]) });
    expect(result).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });

  it("a JPEG declared as a PDF is rejected", async () => {
    const input = await solid(100, 100).jpeg().toBuffer();
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: ab(input) })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });

  it("a PNG declared as a JPEG is rejected (declared type and bytes must agree)", async () => {
    const input = await solid(100, 100).png().toBuffer();
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });

  it("HTML / SVG / script content under an allowed declared type is rejected", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>").buffer as ArrayBuffer;
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>').buffer as ArrayBuffer;
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "application/pdf", bytes: html })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/png", bytes: svg })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });

  it.each(["image/gif", "image/svg+xml", "image/avif", "text/html", "application/zip", ""])("declared type %j is not on the allow-list", async (mime) => {
    const input = await solid(50, 50).jpeg().toBuffer();
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: mime, bytes: ab(input) })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });
});

describe("prepareVehicleDocumentForStorage — HEIC/HEIF is refused explicitly", () => {
  it.each(["heic", "heix", "hevc", "mif1", "msf1", "heif"])("ftyp brand %s → HEIC_UNSUPPORTED (by signature)", async (brand) => {
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/heic", bytes: isoBmffHeader(brand) })).toEqual({ ok: false, error: "HEIC_UNSUPPORTED" });
  });

  it("a HEIC renamed to .jpg / declared image/jpeg is STILL identified as HEIC (clear message, not a generic mismatch)", async () => {
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: isoBmffHeader("heic") })).toEqual({ ok: false, error: "HEIC_UNSUPPORTED" });
  });

  it("the bundled decoder really has no HEVC support (the reason for the refusal)", () => {
    // libvips' prebuilt HEIF loader is AVIF-only. If this ever changes, the HEIC decision must be revisited.
    const heif = sharp.format.heif as unknown as { input: { fileSuffix?: string[] } };
    expect(heif.input.fileSuffix ?? []).not.toContain(".heic");
  });
});

describe("prepareVehicleDocumentForStorage — size and resource limits", () => {
  it("empty file → EMPTY_FILE", async () => {
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: new ArrayBuffer(0) })).toEqual({ ok: false, error: "EMPTY_FILE" });
  });

  it("a body above the absolute ceiling is rejected BEFORE any signature check or decode", async () => {
    // JPEG magic followed by garbage: were it decoded it would be IMAGE_CORRUPT; TOO_LARGE proves the order.
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: big.buffer as ArrayBuffer })).toEqual({ ok: false, error: "TOO_LARGE" });
    // exactly at the ceiling is still considered (and then fails as a corrupt image, not as too large)
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    atLimit.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: atLimit.buffer as ArrayBuffer })).toEqual({ ok: false, error: "IMAGE_CORRUPT" });
  });

  it("an image over the pixel limit is rejected from its header alone (decompression-bomb guard)", async () => {
    // A tiny file that DECLARES 8000×7000 = 56 MP: a solid colour compresses to a few kilobytes.
    const bomb = await solid(8000, 7000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(8000 * 7000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/png", bytes: ab(bomb) })).toEqual({ ok: false, error: "IMAGE_TOO_LARGE" });
  }, 60_000);

  it("a large photo is downsized to the normalized target (long edge and bytes)", async () => {
    const input = await solid(6000, 4000).jpeg({ quality: 90 }).toBuffer(); // 24 MP
    const { result, meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) }));
    expect(Math.max(meta.width!, meta.height!)).toBe(NORMALIZED_IMAGE_MAX_EDGE);
    expect(meta).toMatchObject({ width: 3000, height: 2000 }); // aspect ratio preserved
    expect(result.bytes.byteLength).toBeLessThanOrEqual(NORMALIZED_IMAGE_TARGET_BYTES);
  }, 60_000);

  it("a detailed photo that does not fit at full quality is stepped down until it fits the byte target", async () => {
    // High-entropy content: under the upload ceiling as sent, but over the 2 MiB target at 3000px/q85.
    const input = await noise(3000, 2250).jpeg({ quality: 35 }).toBuffer();
    expect(input.byteLength).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    const { result, meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) }));
    expect(result.bytes.byteLength).toBeLessThanOrEqual(NORMALIZED_IMAGE_TARGET_BYTES);
    // It did NOT fit at the full 3000px edge, so a smaller step was used (aspect ratio preserved).
    expect(Math.max(meta.width!, meta.height!)).toBeLessThan(NORMALIZED_IMAGE_MAX_EDGE);
    expect(meta.width! / meta.height!).toBeCloseTo(3000 / 2250, 2);
  }, 60_000);
});

describe("prepareVehicleDocumentForStorage — orientation and metadata", () => {
  it("applies the EXIF orientation to the pixels and drops the tag", async () => {
    // 400×200 landscape pixels tagged 'rotate 90° CW' (orientation 6) → a 200×400 portrait image.
    const input = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const { meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) }));
    expect(meta).toMatchObject({ width: 200, height: 400 });
    expect(meta.orientation).toBeUndefined();
  });

  it("removes EXIF — including GPS position, device make/model and capture time — and ICC", async () => {
    const input = await solid(600, 400)
      .jpeg()
      .withExif({
        IFD0: { Make: "SyntheticPhoneCo", Model: "TestPhone 1", Software: "synthetic-fixture" },
        IFD2: { DateTimeOriginal: "2026:01:02 03:04:05" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "23/1 35/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "58/1 24/1 0/1" },
      })
      .withIccProfile("srgb")
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined(); // the fixture really carries EXIF
    expect(input.includes("SyntheticPhoneCo")).toBe(true);

    const { buf, meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(input) }));
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    for (const needle of ["Exif", "SyntheticPhoneCo", "TestPhone", "2026:01:02", "GPS"]) expect(buf.includes(needle)).toBe(false);
  });

  it("PNG text chunks / EXIF do not survive either", async () => {
    const input = await solid(300, 300).png().withExif({ IFD0: { Copyright: "synthetic-owner-name" } }).toBuffer();
    const { buf, meta } = await stored(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/png", bytes: ab(input) }));
    expect(meta.exif).toBeUndefined();
    expect(buf.includes("synthetic-owner-name")).toBe(false);
  });
});

describe("prepareVehicleDocumentForStorage — corrupt input fails safely", () => {
  it("valid JPEG signature + garbage body → IMAGE_CORRUPT", async () => {
    const bytes = new Uint8Array(2048);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: bytes.buffer as ArrayBuffer })).toEqual({ ok: false, error: "IMAGE_CORRUPT" });
  });

  it("a truncated JPEG (connection cut mid-file) → IMAGE_CORRUPT, never a half-image stored", async () => {
    const full = await noise(1200, 900).jpeg({ quality: 80 }).toBuffer();
    const truncated = full.subarray(0, Math.floor(full.byteLength / 3));
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/jpeg", bytes: ab(Buffer.from(truncated)) })).toEqual({ ok: false, error: "IMAGE_CORRUPT" });
  });

  it("a truncated PNG → IMAGE_CORRUPT", async () => {
    const full = await noise(800, 600).png().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.byteLength / 2));
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "image/png", bytes: ab(Buffer.from(truncated)) })).toEqual({ ok: false, error: "IMAGE_CORRUPT" });
  });

  it("an encrypted (password-protected) registration PDF is refused, never stored", async () => {
    const result = await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: buildEncryptedPdf() });
    expect(result).toEqual({ ok: false, error: "PDF_ENCRYPTED" });
  });

  it("a corrupt registration PDF (valid header, garbage body) → PDF_CORRUPT", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nthis is not a pdf body at all\n").buffer as ArrayBuffer;
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes })).toEqual({ ok: false, error: "PDF_CORRUPT" });
  });

  it("a registration PDF over the page limit → PDF_TOO_MANY_PAGES", async () => {
    const pages = Array.from({ length: 9 }, (_, i) => [`page ${i + 1}`]);
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: buildSyntheticPdf(pages) })).toEqual({ ok: false, error: "PDF_TOO_MANY_PAGES" });
  });

  it("a PDF with a payload appended after the end marker (polyglot) → PDF_CORRUPT", async () => {
    const pdf = Buffer.from(buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]));
    const polyglot = Buffer.concat([pdf, Buffer.from("\nMZ" + "A".repeat(4096))]);
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: ab(polyglot) })).toEqual({ ok: false, error: "PDF_CORRUPT" });
  });

  it("no failure ever echoes file content: the result is only a fixed error code", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nPlate T 99001 owner synthetic\n").buffer as ArrayBuffer;
    const result = await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes });
    expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
  });
});

describe("prepareVehicleDocumentForStorage — the registration-only PDF rule applies to VEHICLE_REGISTRATION and nothing else", () => {
  const longPdf = () => buildSyntheticPdf(Array.from({ length: 12 }, (_, i) => [`synthetic policy page ${i + 1}`]));
  const garbagePdf = () => new TextEncoder().encode("%PDF-1.4\nthis is not a pdf body at all\n").buffer as ArrayBuffer;

  it.each(["VEHICLE_INSURANCE", "SOME_FUTURE_VEHICLE_DOCUMENT"])("%s: a 12-page PDF is accepted and stored byte-for-byte (no registration page limit)", async (documentType) => {
    const bytes = longPdf();
    const size = bytes.byteLength;
    const result = await prepareVehicleDocumentForStorage({ documentType, declaredMimeType: "application/pdf", bytes });
    expect(result).toMatchObject({ ok: true, mimeType: "application/pdf", ext: "pdf", normalized: false });
    if (result.ok) {
      expect(result.bytes).toBe(bytes);
      expect(result.bytes.byteLength).toBe(size); // never handed to the registration parser
    }
  });

  it("VEHICLE_INSURANCE: an encrypted PDF, or one the registration parser could not open, is still accepted (signature-only, as before)", async () => {
    expect((await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "application/pdf", bytes: buildEncryptedPdf() })).ok).toBe(true);
    expect((await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_INSURANCE", declaredMimeType: "application/pdf", bytes: garbagePdf() })).ok).toBe(true);
  });

  it("VEHICLE_REGISTRATION: the very same files are refused by the registration rule", async () => {
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: longPdf() })).toEqual({ ok: false, error: "PDF_TOO_MANY_PAGES" });
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: buildEncryptedPdf() })).toEqual({ ok: false, error: "PDF_ENCRYPTED" });
    expect(await prepareVehicleDocumentForStorage({ documentType: "VEHICLE_REGISTRATION", declaredMimeType: "application/pdf", bytes: garbagePdf() })).toEqual({ ok: false, error: "PDF_CORRUPT" });
  });

  it("the generic vehicle rules (ceiling, signature, HEIC, image normalization) apply to every vehicle document type alike", async () => {
    for (const documentType of ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"]) {
      expect(await prepareVehicleDocumentForStorage({ documentType, declaredMimeType: "image/heic", bytes: isoBmffHeader("heic") })).toEqual({ ok: false, error: "HEIC_UNSUPPORTED" });
      expect(await prepareVehicleDocumentForStorage({ documentType, declaredMimeType: "application/pdf", bytes: new ArrayBuffer(MAX_UPLOAD_BYTES + 1) })).toEqual({ ok: false, error: "TOO_LARGE" });
      const image = await prepareVehicleDocumentForStorage({ documentType, declaredMimeType: "image/png", bytes: ab(await solid(200, 100).png().toBuffer()) });
      expect(image).toMatchObject({ ok: true, mimeType: "image/jpeg", ext: "jpg", normalized: true });
    }
  });
});
