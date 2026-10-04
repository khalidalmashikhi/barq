import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildSyntheticPdf, buildEncryptedPdf, isoBmffHeader } from "@/lib/vehicles/documents/synthetic-test-documents";

// SCOPE-ISOLATION REGRESSION (Phase 3C Slice 3B correction).
//
// Provider-VERIFICATION documents (identity, commercial registration, licences, vertical evidence,
// admin-configured requirements) are a separate domain from VEHICLE documents. The vehicle slice
// added image normalization and a registration-PDF rule; NONE of that may reach this subsystem
// merely because both store files privately. This suite pins, for EVERY provider document type and
// for both upload and replace, that a provider document is stored exactly as it was received, under
// the subsystem's own validation, with no vehicle parser and no image re-encoding involved.
//
// The REAL validateDocumentUpload runs. The vehicle-side modules are replaced by tripwires that
// fail the test if this subsystem ever loads or calls them.

vi.mock("server-only", () => ({}));

const tripwire = (name: string) => () => {
  throw new Error(`provider documents must never use ${name}`);
};
vi.mock("@/lib/file-safety/normalize-private-image", () => ({ normalizePrivateImage: tripwire("the image normalizer") }));
vi.mock("@/lib/vehicles/documents/prepare-vehicle-document", () => ({ prepareVehicleDocumentForStorage: tripwire("the vehicle-document policy") }));
vi.mock("@/lib/vehicles/registration-extraction/registration-pdf-policy", () => ({ checkRegistrationPdfStructure: tripwire("the vehicle-registration PDF rule") }));
vi.mock("@/lib/vehicles/registration-extraction/pdf-text", () => ({ extractPdfText: tripwire("the vehicle-registration PDF parser") }));
// Vehicle-registration OCR: a provider-verification document (identity, licence, …) must NEVER be
// sent to the OCR engine or run through the registration extraction service.
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => ({
  getRegistrationDocumentReader: tripwire("the vehicle-registration OCR engine"),
  isRegistrationOcrOperational: tripwire("the vehicle-registration OCR engine"),
}));
vi.mock("@/lib/vehicles/registration-extraction/ocr/claude-vision-reader", () => ({ createClaudeVisionRegistrationReader: tripwire("the vehicle-registration OCR engine") }));
vi.mock("@/lib/vehicles/registration-extraction/extract-registration-service", () => ({ runVehicleRegistrationExtraction: tripwire("the vehicle-registration extraction service") }));

const { requireProviderMock, ForbiddenError, UnauthenticatedError } = vi.hoisted(() => ({
  requireProviderMock: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a), ForbiddenError, UnauthenticatedError }));

const findUniqueMock = vi.fn();
const createMock = vi.fn();
const updateManyMock = vi.fn();
const requirementFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    providerVerificationRequirement: { findMany: (...a: unknown[]) => requirementFindManyMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerDocument: { create: (...a: unknown[]) => createMock(...a), updateMany: (...a: unknown[]) => updateManyMock(...a) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }),
  },
}));
const uploadMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => true,
  uploadPrivateObject: (...a: unknown[]) => uploadMock(...a),
  removePrivateObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/provider-notification-events", () => ({
  PROVIDER_NOTIFICATION_EVENT: { DOCUMENT_UPLOADED: "provider.document_uploaded", DOCUMENT_REPLACED: "provider.document_replaced" },
  notifyAdminsOfProviderEvent: vi.fn(),
}));

const { uploadProviderDocument } = await import("./upload-provider-document");
const { replaceProviderDocument } = await import("./replace-provider-document");
const { documentVersionToken } = await import("./document-version-token");
const { PROVIDER_DOCUMENT_TYPE_KEYS } = await import("@/lib/provider-document-types/registry");
const { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES, validateDocumentUpload } = await import("./document-constants");
const { MAX_REGISTRATION_PDF_PAGES } = await import("@/lib/vehicles/registration-extraction/constants");

const ab = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const same = (a: ArrayBuffer, b: ArrayBuffer) => Buffer.from(a).equals(Buffer.from(b));
const stored = () => uploadMock.mock.calls.at(-1)![0] as { objectKey: string; body: ArrayBuffer; contentType: string };

// A provider document well beyond the vehicle-registration page limit, an encrypted one, and
// images carrying metadata — all synthetic.
const MANY_PAGES = MAX_REGISTRATION_PDF_PAGES + 4;
const longPdf = () => buildSyntheticPdf(Array.from({ length: MANY_PAGES }, (_, i) => [`synthetic provider document page ${i + 1}`]));
const exifImage = (format: "jpeg" | "png" | "webp") =>
  sharp({ create: { width: 900, height: 600, channels: 3, background: "#225588" } })
    [format]()
    .withExif({ IFD0: { Make: "SyntheticScannerCo", Software: "synthetic-fixture" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();

const OLD_KEY = "provider-documents/prov-1/identity_proof/old.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT", providerType: "COMPANY" } });
  findUniqueMock.mockResolvedValue(null);
  requirementFindManyMock.mockResolvedValue([]);
  uploadMock.mockResolvedValue(undefined);
  createMock.mockResolvedValue({ id: "doc-1" });
  updateManyMock.mockResolvedValue({ count: 1 });
});

describe("ProviderDocument upload — unchanged for EVERY document type", () => {
  it("the registry still lists the provider document types this suite covers", () => {
    expect([...PROVIDER_DOCUMENT_TYPE_KEYS].sort()).toEqual(
      ["COMMERCIAL_REGISTRATION", "IDENTITY_PROOF", "RENTAL_ACTIVITY_LICENCE", "RENTAL_BUSINESS_REGISTRATION", "TOURISM_LICENCE", "TOURIST_GUIDE_LICENCE"].sort(),
    );
  });

  it.each([...PROVIDER_DOCUMENT_TYPE_KEYS])("%s: a %d-page PDF (longer than the vehicle-registration limit) is accepted and stored byte-for-byte", async (type) => {
    const bytes = longPdf();
    const original = bytes.slice(0);
    const result = await uploadProviderDocument({ type, originalFilename: "evidence.pdf", declaredMimeType: "application/pdf", bytes });
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    expect(stored().body).toBe(bytes); // the very bytes received
    expect(same(stored().body, original)).toBe(true); // and not consumed/emptied by any parser
    expect(stored().contentType).toBe("application/pdf");
    expect(stored().objectKey).toMatch(new RegExp(`^provider-documents/prov-1/${type.toLowerCase()}/[0-9a-f-]+\\.pdf$`));
    expect(createMock.mock.calls[0]![0].data).toMatchObject({ type, mimeType: "application/pdf", sizeBytes: original.byteLength, status: "PENDING" });
  });

  it.each([...PROVIDER_DOCUMENT_TYPE_KEYS])("%s: a password-protected PDF is still accepted (this subsystem never opened PDFs)", async (type) => {
    const bytes = buildEncryptedPdf();
    expect(await uploadProviderDocument({ type, originalFilename: "evidence.pdf", declaredMimeType: "application/pdf", bytes })).toEqual({ ok: true, documentId: "doc-1" });
    expect(stored().body).toBe(bytes);
  });

  it.each([
    ["image/jpeg", "jpeg", "jpg"],
    ["image/png", "png", "png"],
    ["image/webp", "webp", "webp"],
  ] as const)("an %s image is stored AS RECEIVED — same bytes, same type, same extension, metadata untouched (no normalization)", async (mime, format, ext) => {
    for (const type of PROVIDER_DOCUMENT_TYPE_KEYS) {
      const input = await exifImage(format);
      const bytes = ab(input);
      const result = await uploadProviderDocument({ type, originalFilename: `scan.${ext}`, declaredMimeType: mime, bytes });
      expect(result).toEqual({ ok: true, documentId: "doc-1" });
      expect(stored().body).toBe(bytes);
      expect(stored().contentType).toBe(mime);
      expect(stored().objectKey.endsWith(`.${ext}`)).toBe(true);
      const meta = await sharp(Buffer.from(stored().body)).metadata();
      expect(meta.format).toBe(format);
      expect(meta.width).toBe(900); // NOT rotated, NOT resized
      expect(meta.exif).toBeDefined(); // NOT stripped — this subsystem's bytes are untouched
      expect(createMock.mock.calls.at(-1)![0].data).toMatchObject({ mimeType: mime, sizeBytes: input.byteLength });
    }
  });

  it("an ADMIN-CONFIGURED custom requirement key (ADR-0017) behaves the same", async () => {
    requirementFindManyMock.mockResolvedValue([{ key: "VAT_CERTIFICATE", active: true }]);
    const bytes = longPdf();
    expect(await uploadProviderDocument({ type: "VAT_CERTIFICATE", originalFilename: "vat.pdf", declaredMimeType: "application/pdf", bytes })).toEqual({ ok: true, documentId: "doc-1" });
    expect(stored().body).toBe(bytes);
  });

  it("its OWN validation stays authoritative, with its OWN error codes (no vehicle-only code can appear)", async () => {
    const base = { type: "IDENTITY_PROOF", originalFilename: "x" };
    // HEIC: this subsystem has no HEIC-specific outcome — the existing allow-list/signature answers apply.
    expect(await uploadProviderDocument({ ...base, declaredMimeType: "image/heic", bytes: isoBmffHeader("heic") })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(await uploadProviderDocument({ ...base, declaredMimeType: "image/jpeg", bytes: isoBmffHeader("heic") })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
    // A corrupt image with a valid signature was, and still is, accepted (magic bytes only).
    const corrupt = new Uint8Array(2048);
    corrupt.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await uploadProviderDocument({ ...base, declaredMimeType: "image/jpeg", bytes: corrupt.buffer as ArrayBuffer })).toEqual({ ok: true, documentId: "doc-1" });
    // Size, emptiness and MIME rules are its own.
    expect(await uploadProviderDocument({ ...base, declaredMimeType: "application/pdf", bytes: new ArrayBuffer(0) })).toEqual({ ok: false, error: "EMPTY_FILE" });
    expect(await uploadProviderDocument({ ...base, declaredMimeType: "application/pdf", bytes: new ArrayBuffer(MAX_DOCUMENT_BYTES + 1) })).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(await uploadProviderDocument({ ...base, declaredMimeType: "image/gif", bytes: longPdf() })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });
});

describe("ProviderDocument replace — unchanged", () => {
  const existing = (type: string) => ({ id: "doc-1", providerId: "prov-1", type, status: "PENDING", objectKey: OLD_KEY, provider: { status: "DRAFT", providerType: "COMPANY" } });

  it.each([...PROVIDER_DOCUMENT_TYPE_KEYS])("%s: a long PDF replaces the document and is stored byte-for-byte", async (type) => {
    findUniqueMock.mockResolvedValue(existing(type));
    const bytes = longPdf();
    const result = await replaceProviderDocument({ documentId: "doc-1", expectedVersionToken: documentVersionToken(OLD_KEY), originalFilename: "new.pdf", declaredMimeType: "application/pdf", bytes });
    expect(result).toMatchObject({ ok: true });
    expect(stored().body).toBe(bytes);
    expect(stored().contentType).toBe("application/pdf");
  });

  it("a replacement image keeps its bytes, type and metadata", async () => {
    findUniqueMock.mockResolvedValue(existing("IDENTITY_PROOF"));
    const input = await exifImage("png");
    const bytes = ab(input);
    const result = await replaceProviderDocument({ documentId: "doc-1", expectedVersionToken: documentVersionToken(OLD_KEY), originalFilename: "new.png", declaredMimeType: "image/png", bytes });
    expect(result).toMatchObject({ ok: true });
    expect(stored().body).toBe(bytes);
    expect(stored().contentType).toBe("image/png");
    expect(stored().objectKey.endsWith(".png")).toBe(true);
  });
});

describe("ProviderDocument — its contract is its own", () => {
  it("accepted formats and the size ceiling are exactly what they were", () => {
    expect(Object.keys(ALLOWED_DOCUMENT_MIME_TYPES).sort()).toEqual(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    expect(MAX_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
    // The shared validator is a pure signature/MIME/size check: it reports the format it saw and
    // never transforms anything.
    const pdf = longPdf();
    expect(validateDocumentUpload({ declaredMimeType: "application/pdf", sizeBytes: pdf.byteLength, head: new Uint8Array(pdf) })).toEqual({ ok: true, ext: "pdf", format: "pdf", mimeType: "application/pdf" });
  });

  it("the provider-document error vocabulary contains none of the vehicle-document outcomes", () => {
    const codes = readFileSync(path.join(process.cwd(), "src/lib/provider/documents/provider-document-error-codes.ts"), "utf8");
    for (const vehicleOnly of [
      "HEIC_UNSUPPORTED", "IMAGE_TOO_LARGE", "IMAGE_CORRUPT", "PDF_ENCRYPTED", "PDF_CORRUPT", "PDF_TOO_MANY_PAGES", "ONBOARDING_CANCELLED", "ONBOARDING_IN_PROGRESS",
      // vehicle-registration OCR / extraction outcomes
      "OCR_NOT_CONFIGURED", "OCR_TIMEOUT", "OCR_PROVIDER_ERROR", "OCR_MALFORMED_RESPONSE", "OCR_UNREADABLE", "NO_TEXT_LAYER", "UNSUPPORTED_LAYOUT", "EXTRACTION_FAILED",
    ]) {
      expect(codes).not.toContain(vehicleOnly);
    }
  });

  // STRUCTURAL: no file of this subsystem — domain, type policy, provider routes, admin review route
  // — depends on the vehicle domain, the image normalizer, the image library or the PDF engine.
  const ROOT = process.cwd();
  const DIRS = ["src/lib/provider/documents", "src/lib/provider-document-types", "src/app/api/provider/documents", "src/app/api/admin/provider-documents"];
  const sources = DIRS.flatMap((dir) =>
    existsSync(path.join(ROOT, dir))
      ? readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
          .map((f) => `${dir}/${f.replace(/\\/g, "/")}`)
          .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      : [],
  );

  it("the subsystem's source set is the one this guard believes it is", () => {
    expect(sources.length).toBeGreaterThan(20);
    for (const must of ["src/lib/provider/documents/upload-provider-document.ts", "src/lib/provider/documents/replace-provider-document.ts", "src/app/api/provider/documents/route.ts", "src/app/api/admin/provider-documents/[id]/review/route.ts"]) {
      expect(sources).toContain(must);
    }
  });

  it.each(sources)("%s never references the OCR configuration, the OCR vendor or the registration extraction tables", (rel) => {
    const text = readFileSync(path.join(ROOT, rel), "utf8");
    expect(text).not.toMatch(/REGISTRATION_OCR|ANTHROPIC|api\.anthropic\.com|vehicleRegistrationExtraction|vehicleRegistrationConfirmation|vehicleOnboardingRequest|RegistrationDocumentReader/);
  });

  it("uploading or replacing a provider document makes NO outbound request at all (no OCR, no vendor call)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("a provider-verification document must never be sent to an external service");
    });
    try {
      for (const type of PROVIDER_DOCUMENT_TYPE_KEYS) {
        expect(await uploadProviderDocument({ type, originalFilename: "scan.jpg", declaredMimeType: "image/jpeg", bytes: ab(await exifImage("jpeg")) })).toEqual({ ok: true, documentId: "doc-1" });
      }
      findUniqueMock.mockResolvedValue({ id: "doc-1", providerId: "prov-1", type: "IDENTITY_PROOF", status: "PENDING", objectKey: OLD_KEY, provider: { status: "DRAFT", providerType: "COMPANY" } });
      expect(await replaceProviderDocument({ documentId: "doc-1", expectedVersionToken: documentVersionToken(OLD_KEY), originalFilename: "new.pdf", declaredMimeType: "application/pdf", bytes: longPdf() })).toMatchObject({ ok: true });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each(sources)("%s imports nothing from the vehicle domain, the image normalizer, sharp or the PDF engine", (rel) => {
    const imports = (readFileSync(path.join(ROOT, rel), "utf8").match(/from\s+["'][^"']+["']|import\(\s*["'][^"']+["']\s*\)/g) ?? []).join("\n");
    expect(imports).not.toMatch(/@\/lib\/vehicles\b|\/vehicles\/|file-safety|["']sharp["']|unpdf|registration-extraction|prepare-vehicle-document|onboarding|\/ocr\/|claude|anthropic/i);
  });
});
