import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MAX_IMAGE_PIXELS, NORMALIZED_IMAGE_MAX_EDGE, NORMALIZED_IMAGE_TARGET_BYTES } from "./image-safety-policy";

// The DOCUMENT-NEUTRAL layer, tested on its own contract with the real decoder: it knows images, not
// documents. (The vehicle-document policy that USES it is tested in prepare-vehicle-document.test.ts.)

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000 });

const { normalizePrivateImage } = await import("./normalize-private-image");

const ab = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } });
/** PNG chunk CRC-32 (so a rewritten header is still a valid chunk). */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("normalizePrivateImage — the neutral contract", () => {
  it.each(["jpeg", "png", "webp"] as const)("%s in → an upright, metadata-free JPEG out", async (format) => {
    const input = await solid(400, 200)[format]().withExif({ IFD0: { Make: "SyntheticCo" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "23/1 35/1 0/1" } }).withMetadata({ orientation: 6 }).toBuffer();
    const out = await normalizePrivateImage(ab(input));
    expect(out).toMatchObject({ ok: true, mimeType: "image/jpeg", ext: "jpg" });
    if (!out.ok) return;
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 200, height: 400 }); // orientation applied to the pixels
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.hasAlpha).toBe(false);
    expect(Buffer.from(out.bytes).includes("SyntheticCo")).toBe(false);
  });

  it("never enlarges, and brings a large image within the edge and byte targets", async () => {
    const small = await normalizePrivateImage(ab(await solid(120, 80).jpeg().toBuffer()));
    expect(small.ok && (await sharp(Buffer.from(small.bytes)).metadata())).toMatchObject({ width: 120, height: 80 });
    const large = await normalizePrivateImage(ab(await solid(3600, 2400).jpeg({ quality: 90 }).toBuffer()));
    if (!large.ok) throw new Error(large.error);
    expect(await sharp(Buffer.from(large.bytes)).metadata()).toMatchObject({ width: NORMALIZED_IMAGE_MAX_EDGE, height: 2000 });
    expect(large.bytes.byteLength).toBeLessThanOrEqual(NORMALIZED_IMAGE_TARGET_BYTES);
  });

  it("refuses an over-limit image from its header (no decode) and a corrupt one safely", async () => {
    // A real decompression bomb: a tiny, valid PNG whose HEADER declares 30000×30000 (900 MP). Only
    // the IHDR is rewritten (with a correct CRC) — the few bytes of pixel data are never decoded.
    const bomb = Buffer.from(await solid(16, 16).png().toBuffer());
    bomb.writeUInt32BE(30_000, 16);
    bomb.writeUInt32BE(30_000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
    expect(bomb.byteLength).toBeLessThan(1024);
    expect(30_000 * 30_000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(await normalizePrivateImage(ab(bomb))).toEqual({ ok: false, error: "IMAGE_TOO_LARGE" });
    const garbage = new Uint8Array(2048);
    garbage.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await normalizePrivateImage(garbage.buffer as ArrayBuffer)).toEqual({ ok: false, error: "IMAGE_CORRUPT" });
    expect(await normalizePrivateImage(new ArrayBuffer(0))).toEqual({ ok: false, error: "IMAGE_CORRUPT" });
  });

  it("does not consume the caller's buffer", async () => {
    const bytes = ab(await solid(300, 300).png().toBuffer());
    const size = bytes.byteLength;
    await normalizePrivateImage(bytes);
    expect(bytes.byteLength).toBe(size);
  });
});

describe("src/lib/file-safety is genuinely document-neutral", () => {
  const DIR = path.join(process.cwd(), "src/lib/file-safety");
  const sources = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("consists of the policy and the normalizer only", () => {
    expect(sources.sort()).toEqual(["image-safety-policy.ts", "normalize-private-image.ts"]);
  });

  it.each(sources)("%s imports no domain (vehicle / provider / booking), no storage, no database, no PDF engine, no logger", (file) => {
    const imports = (readFileSync(path.join(DIR, file), "utf8").match(/from\s+["'][^"']+["']/g) ?? []).join("\n");
    expect(imports).not.toMatch(/@\/lib\/(vehicles|provider|booking|storage|db|logger|audit|auth)|unpdf|pdf/);
    for (const spec of imports.match(/["'][^"']+["']/g) ?? []) expect(['"server-only"', '"sharp"', '"./image-safety-policy"']).toContain(spec);
  });

  it.each(sources)("%s names no document type or business concept in its code", (file) => {
    const code = readFileSync(path.join(DIR, file), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/REGISTRATION|INSURANCE|IDENTITY|LICENCE|Vehicle|Provider|pdf|documentType|AssetDocument/i);
  });
});
