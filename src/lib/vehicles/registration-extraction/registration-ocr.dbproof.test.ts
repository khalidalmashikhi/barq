import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { buildSyntheticPdf, SYNTHETIC_REGISTRATION_LINES } from "@/lib/vehicles/documents/synthetic-test-documents";
import type { RegistrationReadResult } from "./ocr/registration-document-reader";

// Phase 3C (registration OCR) — REAL-PostgreSQL proof of the OCR lifecycle end to end: the actual
// upload route → durable onboarding request → real image/PDF preparation → the real extraction
// service (lease, guarded completion, checksum reuse, transactional audit) → the real review read
// model → the real confirmed finalize. Substituted: the session (which provider is signed in), the
// storage bucket (in-memory) and the OCR ENGINE — a controllable fake that never contacts anyone.
// Every document is synthetic; no real registration card, plate, VIN or person appears.
//
// Gated behind REGISTRATION_DBPROOF=1:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/registration-extraction/registration-ocr.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";

const PROJECT = process.cwd();
const dbName = "barq_ocr_dbproof_" + randomUUID().slice(0, 8);
function urls() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path.join(PROJECT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1]) env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  const base = env.DATABASE_URL ?? "";
  const a = new URL(base); a.pathname = "/postgres";
  const t = new URL(base); t.pathname = "/" + dbName;
  return { admin: a.toString(), throwaway: t.toString() };
}
const throwawayUrl = RUN ? urls().throwaway : "";
if (RUN) { process.env.DATABASE_URL = throwawayUrl; process.env.DIRECT_URL = throwawayUrl; }

const PROV_A = randomUUID(), PROV_B = randomUUID();
const ENGINE = "fake-ocr/v1";

const { session, state } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage: ALS } = require("node:async_hooks") as typeof import("node:async_hooks");
  return {
    session: new ALS<string>(),
    state: {
      storage: new Map<string, ArrayBuffer>(),
      downloadMode: "ok" as "ok" | "fail",
      failExtractionAuditOnce: false,
      ocr: {
        enabled: true,
        answer: null as unknown, // RegistrationReadResult
        calls: [] as { mimeType: string; bytes: ArrayBuffer }[],
        gate: null as null | { entered: () => void; wait: Promise<void> },
      },
    },
  };
});
const as = <T>(providerId: string, fn: () => Promise<T>): Promise<T> => (session as AsyncLocalStorage<string>).run(providerId, fn);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({ withRequestTracing: (_n: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/auth", () => {
  class ForbiddenError extends Error {}
  class UnauthenticatedError extends Error {}
  return {
    ForbiddenError,
    UnauthenticatedError,
    requireApprovedProvider: async () => {
      const id = session.getStore();
      if (!id) throw new UnauthenticatedError();
      return { barqUser: { id }, provider: { id, status: "APPROVED" } };
    },
  };
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => { throw new Error("vehicle onboarding must never consult the rental workspace predicate"); },
}));
vi.mock("@/lib/audit/record-audit-event", async (original) => {
  const real = await original<typeof import("@/lib/audit/record-audit-event")>();
  return {
    recordAuditEvent: (params: Parameters<typeof real.recordAuditEvent>[0], tx: Parameters<typeof real.recordAuditEvent>[1]) => {
      if (params.action === "vehicle.registration_extracted" && state.failExtractionAuditOnce) {
        state.failExtractionAuditOnce = false;
        return Promise.reject(new Error("audit boom"));
      }
      return real.recordAuditEvent(params, tx);
    },
  };
});
vi.mock("@/lib/storage/storage", () => {
  class StorageNotConfiguredError extends Error {}
  return {
    StorageNotConfiguredError,
    isDocumentStorageConfigured: () => true,
    uploadPrivateObject: async (p: { objectKey: string; body: ArrayBuffer }) => { state.storage.set(p.objectKey, p.body); },
    downloadPrivateObject: async (objectKey: string) => {
      if (state.downloadMode === "fail") throw new Error("ECONNRESET while reading " + objectKey);
      const body = state.storage.get(objectKey);
      if (!body) throw new Error("Object not found");
      return body.slice(0);
    },
    removePrivateObject: async (objectKey: string) => { state.storage.delete(objectKey); },
  };
});
// The OCR ENGINE: a fake behind the real provider-neutral interface. It records what it was given
// and can be held mid-call. It is the only thing standing in for the external vendor.
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => {
  const reader = {
    engine: "fake-ocr/v1",
    read: async (input: { bytes: ArrayBuffer; mimeType: string }) => {
      state.ocr.calls.push({ mimeType: input.mimeType, bytes: input.bytes.slice(0) });
      const gate = state.ocr.gate;
      if (gate) {
        state.ocr.gate = null; // holds exactly ONE call
        gate.entered();
        await gate.wait;
      }
      return state.ocr.answer;
    },
  };
  return {
    getRegistrationDocumentReader: () => (state.ocr.enabled ? reader : null),
    isRegistrationOcrOperational: () => state.ocr.enabled,
    resolveRegistrationOcrProvider: () => (state.ocr.enabled ? "claude" : "disabled"),
  };
});

const { POST } = await import("@/app/api/provider/vehicles/onboarding/upload/route");
const { startVehicleOnboarding } = await import("@/lib/vehicles/onboarding/start-vehicle-onboarding");
const { cancelVehicleOnboardingRequest } = await import("@/lib/vehicles/onboarding/cancel-onboarding-request");
const { finalizeVehicleFromRegistration } = await import("@/lib/vehicles/onboarding/finalize-vehicle");
const { runRegistrationAnalysis } = await import("@/lib/vehicles/registration-review/run-registration-analysis");
const { getRegistrationReview } = await import("@/lib/vehicles/registration-review/get-registration-review");
const { writeRegistrationConfirmation } = await import("@/lib/vehicles/registration-review/write-confirmation");

let admin: PrismaClient, db: PrismaClient;

const ab = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const sha = (bytes: ArrayBuffer) => createHash("sha256").update(Buffer.from(bytes)).digest("hex");
/** A synthetic "photo" — distinct per seed so different tests upload different bytes. */
const photo = async (seed: number, orientation?: number) => {
  let img = sharp({ create: { width: 900 + seed, height: 600, channels: 3, background: { r: (seed * 37) % 255, g: 120, b: 200 } } }).jpeg({ quality: 80 });
  if (orientation) img = img.withMetadata({ orientation });
  return ab(await img.toBuffer());
};
const newKey = () => randomUUID();
let plateSeq = 100;
const READ = (over: Record<string, { text: string; unclear?: boolean }[]> = {}): RegistrationReadResult => ({
  ok: true,
  candidates: {
    plateNumber: [{ text: `T ${++plateSeq}` }],
    makeDescription: [{ text: "Toyota" }],
    model: [{ text: "Testcruiser" }],
    color: [{ text: "White" }],
    manufactureYear: [{ text: "2020" }],
    licensedPassengerCapacity: [{ text: "7" }],
    vin: [{ text: "TESTV1N0000000001" }],
    licenseExpiry: [{ text: "31/05/2027" }],
    ...over,
  },
});

function uploadRequest(requestKey: string, body: ArrayBuffer, type = "image/jpeg", name = "IMG_0001.jpg") {
  const form = new FormData();
  form.set("locale", "en");
  form.set("requestKey", requestKey);
  form.set("file", new File([body], name, { type }));
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", { method: "POST", body: form, headers: { accept: "application/json" } });
}
type Json = { ok: boolean; redirectTo?: string; replayed?: boolean; error?: string };
const idOf = (json: Json) => json.redirectTo!.split("/").pop()!.split("?")[0]!;
async function upload(provider: string, key: string, body: ArrayBuffer, type?: string, name?: string) {
  const res = await as(provider, () => POST(uploadRequest(key, body, type, name)));
  return { status: res.status, json: (await res.json()) as Json };
}
function holdNextOcrCall() {
  let entered!: () => void, release!: () => void;
  const inFlight = new Promise<void>((r) => (entered = r));
  const wait = new Promise<void>((r) => (release = r));
  state.ocr.gate = { entered, wait };
  return { inFlight, release };
}

const q = <T>(sql: string, ...params: unknown[]) => db.$queryRawUnsafe(sql, ...params) as Promise<T[]>;
const n = async (sql: string, ...params: unknown[]) => Number((await q<{ n: number }>(sql, ...params))[0]!.n);
type ExtRow = { id: string; status: string; source: string; ocrEngine: string | null; failureCode: string | null; fields: Record<string, { normalizedValue: unknown; confidence: string; warnings: string[] }> | null; warnings: string[] | null; attemptCount: number; processingToken: string | null; documentSha256: string };
const extractionsFor = (assetId: string) =>
  q<ExtRow>(`SELECT id, status::text, source, "ocrEngine", "failureCode", fields, warnings, "attemptCount", "processingToken"::text, "documentSha256" FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, assetId);
const extractionAudits = (assetId: string) => n(`SELECT count(*)::int n FROM "audit_logs" WHERE action='vehicle.registration_extracted' AND "entityId"=$1::uuid`, assetId);
const assetExists = async (id: string) => (await n(`SELECT count(*)::int n FROM "assets" WHERE id=$1::uuid`, id)) === 1;
const vehicleRow = async (id: string) => (await q<Record<string, unknown>>(`SELECT make, model, "modelYear", color, "registrationNumber", "passengerCapacity" AS "bookablePassengerCapacity", "registeredSeats", "vehicleType" FROM "vehicles" WHERE "assetId"=$1::uuid`, id))[0]!;
const tableCount = (t: string) => n(`SELECT count(*)::int n FROM "${t}"`);
const confirmed = (over: Record<string, unknown> = {}) => ({
  make: "Toyota", model: "Testcruiser", modelYear: "2020", color: "White",
  bookablePassengerCapacity: "5", licensedPassengerCapacity: "7", registeredSeats: "8",
  plateNumber: `T ${++plateSeq}`, vin: "TESTV1N0000000001", licenseExpiry: "31/05/2027", vehicleType: "SUV", declarationAccepted: "true",
  ...over,
});

beforeAll(async () => {
  if (!RUN) return;
  admin = new PrismaClient({ datasources: { db: { url: urls().admin } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: PROJECT, stdio: "ignore", env: { ...process.env, DATABASE_URL: throwawayUrl, DIRECT_URL: throwawayUrl } });
  db = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    for (const id of [PROV_A, PROV_B]) {
      await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, id, randomUUID());
    }
  });
}, 240_000);

afterAll(async () => {
  if (!RUN) return;
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.$disconnect();
});

beforeEach(() => {
  state.downloadMode = "ok";
  state.failExtractionAuditOnce = false;
  state.ocr.enabled = true;
  state.ocr.answer = READ();
  state.ocr.calls.length = 0;
  state.ocr.gate = null;
});

describe.skipIf(!RUN)("registration OCR lifecycle — real PostgreSQL", () => {
  it("schema: PROCESSING exists, the lease/engine columns are nullable, and the checksum index is present", async () => {
    const labels = (await q<{ l: string }>(`SELECT e.enumlabel l FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='VehicleRegistrationExtractionStatus' ORDER BY e.enumsortorder`)).map((r) => r.l);
    expect(labels).toEqual(["EXTRACTED", "NEEDS_REVIEW", "FAILED", "PROCESSING"]);
    const cols = await q<{ column_name: string; is_nullable: string }>(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='vehicle_registration_extractions' AND column_name IN ('ocrEngine','processingToken','processingExpiresAt') ORDER BY 1`);
    expect(cols).toEqual([{ column_name: "ocrEngine", is_nullable: "YES" }, { column_name: "processingExpiresAt", is_nullable: "YES" }, { column_name: "processingToken", is_nullable: "YES" }]);
    expect(await n(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='vehicle_registration_extractions_documentSha256_idx'`)).toBe(1);
  });

  it("a PHOTO is read by OCR once; the result is a SUGGESTION to review — the vehicle stays blank until the provider confirms", async () => {
    state.ocr.answer = READ({ manufactureYear: [{ text: "2020" }], plateNumber: [{ text: "T 55001", unclear: true }] });
    const { status, json } = await upload(PROV_A, newKey(), await photo(1));
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, replayed: false });
    const id = idOf(json);

    expect(state.ocr.calls).toHaveLength(1);
    const ext = (await extractionsFor(id))[0]!;
    expect(ext).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE, failureCode: null, processingToken: null, attemptCount: 1 });
    expect(Object.values(ext.fields!).some((f) => f.confidence === "HIGH")).toBe(false); // never "verified"
    expect(await extractionAudits(id)).toBe(1);

    // Nothing was written to the vehicle: OCR never finalizes.
    expect(Object.values(await vehicleRow(id)).every((v) => v === null)).toBe(true);

    // The review read model: prefilled, sourced, and flagged for review.
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review).toMatchObject({ extractionSource: "OCR", documentMimeType: "image/jpeg" });
    expect(review!.reviewState).toMatchObject({ extraction: "NEEDS_REVIEW", canConfirm: true });
    const field = (k: string) => review!.fields.find((f) => f.key === k)!;
    expect(field("modelYear")).toMatchObject({ extractedValue: 2020, source: "OCR", needsReview: true, confidence: "MEDIUM" });
    expect(field("plateNumber")).toMatchObject({ extractedValue: "T 55001", source: "OCR", needsReview: true, confidence: "LOW" });
    // Never suggested from the document, whatever OCR saw: the provider decides these.
    expect(field("bookablePassengerCapacity")).toMatchObject({ extractedValue: null, source: "UNRESOLVED", needsReview: true });
    expect(field("registeredSeats")).toMatchObject({ extractedValue: null, source: "UNRESOLVED" });

    // The provider CORRECTS the year and confirms → the vehicle carries the CONFIRMED values.
    const done = await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed({ modelYear: "2021", plateNumber: "T 55001" })));
    expect(done).toMatchObject({ ok: true, vehicleId: id });
    expect(await vehicleRow(id)).toMatchObject({ make: "Toyota", modelYear: 2021, registrationNumber: "T 55001", bookablePassengerCapacity: 5, registeredSeats: 8 });
    const after = await as(PROV_A, () => getRegistrationReview(id));
    expect(after!.fields.find((f) => f.key === "modelYear")).toMatchObject({ source: "PROVIDER", needsReview: false, confirmedValue: 2021 });
  }, 60_000);

  it("a ROTATED photo reaches the OCR engine UPRIGHT and without metadata (the stored, normalized bytes are what is read)", async () => {
    const original = await photo(2, 6); // 902×600 pixels tagged "rotate 90°"
    const { json } = await upload(PROV_A, newKey(), original);
    const given = state.ocr.calls[0]!;
    expect(given.mimeType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(given.bytes)).metadata();
    expect(meta).toMatchObject({ width: 600, height: 902 });
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(sha(given.bytes)).toBe((await extractionsFor(idOf(json)))[0]!.documentSha256); // the checksum is of exactly what was read
    expect(sha(given.bytes)).not.toBe(sha(original));
  }, 60_000);

  it("a NATIVE-TEXT PDF never touches the OCR engine, even when one is configured", async () => {
    const { json } = await upload(PROV_A, newKey(), buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]), "application/pdf", "reg.pdf");
    expect(state.ocr.calls).toEqual([]);
    expect((await extractionsFor(idOf(json)))[0]).toMatchObject({ source: "NATIVE_PDF_TEXT", ocrEngine: null });
  });

  it("a SCANNED (image-only) PDF falls back to OCR and is handed over as a PDF", async () => {
    const { json } = await upload(PROV_A, newKey(), buildSyntheticPdf([null]), "application/pdf", "scan.pdf");
    expect(state.ocr.calls).toHaveLength(1);
    expect(state.ocr.calls[0]!.mimeType).toBe("application/pdf");
    expect(state.ocr.calls[0]!.bytes.byteLength).toBeGreaterThan(0);
    expect((await extractionsFor(idOf(json)))[0]).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR" });
  });

  it("SIMULTANEOUS duplicate uploads → one shell, one document, ONE OCR call, one extraction, one audit", async () => {
    for (let round = 0; round < 5; round++) {
      state.ocr.calls.length = 0;
      state.ocr.answer = READ();
      const key = newKey();
      const body = await photo(10 + round);
      const [a, b] = await Promise.all([upload(PROV_A, key, body), upload(PROV_A, key, body)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(idOf(a.json)).toBe(idOf(b.json));
      const id = idOf(a.json);
      expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "assetId"=$1::uuid`, id)).toBe(1);
      expect(state.ocr.calls).toHaveLength(1);
      const rows = await extractionsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "NEEDS_REVIEW", processingToken: null });
      expect(await extractionAudits(id)).toBe(1);
    }
  }, 120_000);

  it("RELOAD / LOST RESPONSE: replaying the same key (and re-running the analysis) never repeats the OCR call", async () => {
    const key = newKey();
    const body = await photo(20);
    const first = await upload(PROV_A, key, body);
    const id = idOf(first.json);
    expect(state.ocr.calls).toHaveLength(1);
    for (let i = 0; i < 3; i++) expect((await upload(PROV_A, key, body)).json).toEqual({ ok: true, redirectTo: `/provider/vehicles/new/${id}?resumed=1`, replayed: true });
    for (let i = 0; i < 2; i++) expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(state.ocr.calls).toHaveLength(1);
    expect(await extractionAudits(id)).toBe(1);
    expect((await extractionsFor(id))[0]!.attemptCount).toBe(1);
  }, 60_000);

  it("OCR TIMEOUT leaves everything retryable: the document and shell are kept, a retry reads it once more, no second shell", async () => {
    state.ocr.answer = { ok: false, code: "OCR_TIMEOUT" };
    const key = newKey();
    const { status, json } = await upload(PROV_A, key, await photo(30));
    expect(status).toBe(200); // the UPLOAD succeeded; the reading did not
    const id = idOf(json);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_TIMEOUT", fields: null });
    expect(await assetExists(id)).toBe(true);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "assetId"=$1::uuid`, id)).toBe(1);
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.reviewState).toMatchObject({ extraction: "FAILED", canAnalyze: true, canConfirm: true, failureLabelKey: "vehicleRegExtractFailOcrTimeout" });

    state.ocr.answer = READ();
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(state.ocr.calls).toHaveLength(2);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "NEEDS_REVIEW", attemptCount: 2 });
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key)).toBe(1);
    expect((await upload(PROV_A, key, await photo(30))).json).toMatchObject({ ok: true, replayed: true }); // still the same shell
  }, 60_000);

  it("MANUAL ENTRY after a failed reading: the provider can finish the SAME shell without any OCR result", async () => {
    state.ocr.answer = { ok: false, code: "OCR_PROVIDER_ERROR" };
    const { json } = await upload(PROV_A, newKey(), await photo(31));
    const id = idOf(json);
    const assetsBefore = await tableCount("assets");
    expect(await as(PROV_A, () => writeRegistrationConfirmation("DRAFT", id, { make: "Toyota" }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: true, vehicleId: id });
    expect(await tableCount("assets")).toBe(assetsBefore); // no other shell was created
    expect((await vehicleRow(id)).make).toBe("Toyota");
  }, 60_000);

  it("MALFORMED engine answer → FAILED, nothing of it is stored", async () => {
    state.ocr.answer = { ok: false, code: "OCR_MALFORMED_RESPONSE" };
    const { json } = await upload(PROV_A, newKey(), await photo(32));
    expect((await extractionsFor(idOf(json)))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_MALFORMED_RESPONSE", fields: null, warnings: null });
  }, 60_000);

  it("INVALID values from the engine are unresolved, and the SAME server validators reject them if a provider submits them", async () => {
    state.ocr.answer = READ({ manufactureYear: [{ text: "2099" }], licensedPassengerCapacity: [{ text: "0" }] });
    const { json } = await upload(PROV_A, newKey(), await photo(33));
    const id = idOf(json);
    const ext = (await extractionsFor(id))[0]!;
    expect(ext.fields!.manufactureYear).toMatchObject({ normalizedValue: null, confidence: "LOW" });
    expect(ext.fields!.licensedPassengerCapacity).toMatchObject({ normalizedValue: null });
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.fields.find((f) => f.key === "modelYear")).toMatchObject({ extractedValue: null, source: "UNRESOLVED", needsReview: true });
    const rejected = await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed({ modelYear: "2099", licensedPassengerCapacity: "0" })));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("INVALID_INPUT");
    expect(Object.values(await vehicleRow(id)).every((v) => v === null)).toBe(true); // nothing was applied
  }, 60_000);

  it("CANCELLATION WHILE OCR IS RUNNING: the late answer is discarded — no extraction, no audit, no resurrection; the key is terminal", async () => {
    const key = newKey();
    const hold = holdNextOcrCall();
    const uploading = upload(PROV_A, key, await photo(40));
    await hold.inFlight; // the shell exists and the OCR call is in flight
    const id = (await q<{ assetId: string }>(`SELECT "assetId"::text FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key))[0]!.assetId;
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "PROCESSING" });
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "PROCESSING", canConfirm: false, canAnalyze: false });
    // While it is being read nothing can be confirmed against the half-finished extraction.
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: false, code: "EXTRACTION_NOT_READY" });

    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true });
    expect(await assetExists(id)).toBe(false);

    hold.release(); // the engine answers — far too late
    await uploading;

    expect(await assetExists(id)).toBe(false); // not resurrected
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id)).toBe(0);
    expect(await extractionAudits(id)).toBe(0); // a discarded answer is not audited as an extraction
    expect((await q<{ status: string; assetId: string | null }>(`SELECT status::text, "assetId"::text FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key))[0]).toEqual({ status: "CANCELLED", assetId: null });
    expect(await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "x.jpg", declaredMimeType: "image/jpeg", bytes: new ArrayBuffer(8) }))).toEqual({ ok: false, error: "ONBOARDING_CANCELLED" });
    expect([...state.storage.keys()].some((k) => k.includes(id))).toBe(false); // the stored document was removed too
  }, 60_000);

  it("a request arriving WHILE the document is being read does not start a second reading", async () => {
    const key = newKey();
    const hold = holdNextOcrCall();
    const uploading = upload(PROV_A, key, await photo(41));
    await hold.inFlight;
    const id = (await q<{ assetId: string }>(`SELECT "assetId"::text FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key))[0]!.assetId;
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "PROCESSING" });
    expect(state.ocr.calls).toHaveLength(1);
    hold.release();
    await uploading;
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "NEEDS_REVIEW" });
    expect(state.ocr.calls).toHaveLength(1);
  }, 60_000);

  it("a STALLED reading (expired lease) is taken over; the stalled attempt's late answer is discarded, the newer result stands", async () => {
    const key = newKey();
    state.ocr.answer = READ({ model: [{ text: "StaleAnswer" }] });
    const hold = holdNextOcrCall();
    const uploading = upload(PROV_A, key, await photo(42));
    await hold.inFlight;
    const id = (await q<{ assetId: string }>(`SELECT "assetId"::text FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key))[0]!.assetId;
    await db.$executeRawUnsafe(`UPDATE "vehicle_registration_extractions" SET "processingExpiresAt"=now() - interval '1 second' WHERE "assetId"=$1::uuid`, id);
    // The lease has expired: the review now offers retry + manual entry instead of waiting forever.
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "FAILED", canAnalyze: true, canConfirm: true, failureLabelKey: "vehicleRegExtractFailOcrTimeout" });

    state.ocr.answer = READ({ model: [{ text: "FreshAnswer" }] });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    hold.release();
    await uploading;

    const ext = (await extractionsFor(id))[0]!;
    expect(ext.fields!.model!.normalizedValue).toBe("FreshAnswer"); // never overwritten by the stale answer
    expect(ext).toMatchObject({ status: "NEEDS_REVIEW", attemptCount: 2, processingToken: null });
    expect(await extractionAudits(id)).toBe(1);
  }, 60_000);

  it("AUDIT FAILURE while completing → the extraction is NOT marked complete, stays retryable, and a retry succeeds", async () => {
    state.failExtractionAuditOnce = true;
    const { status, json } = await upload(PROV_A, newKey(), await photo(50));
    expect(status).toBe(200);
    const id = idOf(json);
    const failed = (await extractionsFor(id))[0]!;
    expect(failed).toMatchObject({ status: "FAILED", failureCode: "EXTRACTION_FAILED", fields: null, processingToken: null });
    expect(await extractionAudits(id)).toBe(0); // no "extracted" audit for something that did not complete
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ canAnalyze: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(await extractionAudits(id)).toBe(1);
  }, 60_000);

  it("STORAGE FAILURE while reading the stored document → nothing is recorded as read; the document survives and a retry works", async () => {
    state.downloadMode = "fail";
    const { status, json } = await upload(PROV_A, newKey(), await photo(51));
    expect(status).toBe(200);
    const id = idOf(json);
    expect(await extractionsFor(id)).toHaveLength(0);
    expect(state.ocr.calls).toEqual([]);
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "NOT_ANALYZED", canAnalyze: true });
    state.downloadMode = "ok";
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(await extractionsFor(id)).toHaveLength(1);
  }, 60_000);

  it("the SAME onboarding key under TWO PROVIDERS, uploading IDENTICAL bytes → two shells and two readings (nothing is shared across providers)", async () => {
    const key = newKey();
    const body = await photo(60);
    const a = await upload(PROV_A, key, body);
    const b = await upload(PROV_B, key, body);
    expect(idOf(a.json)).not.toBe(idOf(b.json));
    expect(a.json.replayed).toBe(false);
    expect(b.json.replayed).toBe(false);
    expect(state.ocr.calls).toHaveLength(2); // identical bytes, but B's result is NOT taken from A's
    expect(sha(state.ocr.calls[0]!.bytes)).toBe(sha(state.ocr.calls[1]!.bytes));
    const [ea, eb] = [(await extractionsFor(idOf(a.json)))[0]!, (await extractionsFor(idOf(b.json)))[0]!];
    expect(ea.warnings ?? []).not.toContain("REUSED_IDENTICAL_DOCUMENT");
    expect(eb.warnings ?? []).not.toContain("REUSED_IDENTICAL_DOCUMENT");
    // B cannot read A's review.
    expect(await as(PROV_B, () => getRegistrationReview(idOf(a.json)))).toBeNull();
  }, 60_000);

  it("the SAME document under two legitimate onboarding keys of ONE provider → two shells, ONE reading (reused by checksum)", async () => {
    const body = await photo(61);
    state.ocr.answer = READ({ model: [{ text: "SharedRead" }] });
    const first = await upload(PROV_A, newKey(), body);
    state.ocr.answer = READ({ model: [{ text: "MustNotBeCalled" }] });
    const second = await upload(PROV_A, newKey(), body);
    expect(idOf(first.json)).not.toBe(idOf(second.json));
    expect(state.ocr.calls).toHaveLength(1);
    const e2 = (await extractionsFor(idOf(second.json)))[0]!;
    expect(e2).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE });
    expect(e2.fields!.model!.normalizedValue).toBe("SharedRead");
    expect(e2.warnings).toContain("REUSED_IDENTICAL_DOCUMENT");
    expect(await extractionAudits(idOf(second.json))).toBe(1); // each setup has its own audit
  }, 60_000);

  it("DUPLICATE registration number is detected by the server and reveals nothing about the other provider's vehicle", async () => {
    const plate = "T 77001";
    const a = await upload(PROV_A, newKey(), await photo(70));
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(idOf(a.json), confirmed({ plateNumber: plate })))).toMatchObject({ ok: true });
    const b = await upload(PROV_B, newKey(), await photo(71));
    const dup = await as(PROV_B, () => finalizeVehicleFromRegistration(idOf(b.json), confirmed({ plateNumber: plate })));
    expect(dup).toEqual({ ok: false, code: "DUPLICATE_REGISTRATION" }); // a code only — no id, owner or detail
    expect(JSON.stringify(dup)).not.toContain(idOf(a.json));
    expect(Object.values(await vehicleRow(idOf(b.json))).every((v) => v === null)).toBe(true); // whole transaction rolled back
  }, 60_000);

  it("OCR NOT CONFIGURED: a photo is stored and goes to manual entry — nothing is sent, nothing is invented", async () => {
    state.ocr.enabled = false;
    const { status, json } = await upload(PROV_A, newKey(), await photo(80));
    expect(status).toBe(200);
    const id = idOf(json);
    expect(state.ocr.calls).toEqual([]);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_NOT_CONFIGURED", fields: null, ocrEngine: null });
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.extractionSource).toBeNull();
    expect(review!.reviewState).toMatchObject({ extraction: "FAILED", canConfirm: true, failureLabelKey: "vehicleRegExtractFailOcrUnavailable" });
    expect(review!.fields.every((f) => f.extractedValue === null)).toBe(true);
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: true });
  }, 60_000);

  it("nothing read by OCR appears in the audit trail, the onboarding request or the cleanup outbox", async () => {
    state.ocr.answer = READ({ plateNumber: [{ text: "LEAK 12345" }], vin: [{ text: "LEAKV1N0000000009" }], makeDescription: [{ text: "LeakMake" }] });
    const { json } = await upload(PROV_A, newKey(), await photo(90));
    const id = idOf(json);
    await as(PROV_A, () => writeRegistrationConfirmation("DRAFT", id, { make: "LeakMake", plateNumber: "LEAK 12345" }));
    for (const needle of ["LEAK 12345", "LEAKV1N0000000009", "LeakMake"]) {
      expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE coalesce("previousValue"::text,'') LIKE $1 OR coalesce("newValue"::text,'') LIKE $1`, `%${needle}%`)).toBe(0);
      expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey" LIKE $1`, `%${needle}%`)).toBe(0);
    }
    const audit = (await q<{ v: Record<string, unknown> }>(`SELECT "newValue" v FROM "audit_logs" WHERE action='vehicle.registration_extracted' AND "entityId"=$1::uuid`, id))[0]!.v;
    expect(audit).toMatchObject({ source: "OCR", aiAssisted: true, ocrEngine: ENGINE, confidence: "SUGGESTION_REQUIRES_PROVIDER_REVIEW" });
    expect(Object.keys(audit).sort()).toEqual(["aiAssisted", "confidence", "failureCode", "fieldsNeedingReview", "fieldsRead", "ocrEngine", "parserVersion", "reason", "requestId", "source", "status"]);
  }, 60_000);

  it("no duplicate shell / document / extraction anywhere, and no Booking / reservation / offering / service / pricing / payment / vertical writes", async () => {
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetId" FROM "asset_documents" WHERE type='VEHICLE_REGISTRATION' GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetDocumentId" FROM "vehicle_registration_extractions" GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetId" FROM "vehicle_onboarding_requests" WHERE "assetId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_extractions" WHERE status='PROCESSING'`)).toBe(0); // nothing left mid-read
    expect(await n(`SELECT count(*)::int n FROM (SELECT "entityId" FROM "audit_logs" WHERE action='vehicle.onboarding_draft_created' GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    for (const t of ["bookings", "vehicle_reservations", "rental_vehicle_day_reservations", "rental_offerings", "guided_tour_vehicle_offerings", "services", "prices", "payments", "commissions", "provider_verticals", "provider_categories", "tour_service_vehicles"]) {
      expect(await tableCount(t), t).toBe(0);
    }
    // OCR approved nothing: no asset was activated or verified by any of the above.
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE status <> 'REGISTERED' OR "verificationStatus" = 'APPROVED'`)).toBe(0);
  });
});
