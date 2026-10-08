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

// Phase 3C (registration OCR + privacy gate) — REAL-PostgreSQL proof of the OCR lifecycle end to
// end: the actual upload route → durable onboarding request → real image/PDF preparation → the real
// extraction service (CONSENT gate, lease, call budget via the real durable rate limiter, guarded
// completion, checksum reuse, transactional audit) → the real consent decision function → the real
// review read model → the real confirmed finalize. Substituted: the session (which provider is
// signed in), the storage bucket (in-memory) and the OCR ENGINE — a controllable fake that never
// contacts anyone. Every document is synthetic; no real registration card, plate, VIN or person
// appears.
//
// Gated behind REGISTRATION_DBPROOF=1:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/registration-extraction/registration-ocr.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";

// The real call budget is exercised by one dedicated test; everywhere else it must not interfere.
process.env.RATE_LIMIT_REGISTRATION_OCR_MAX = "1000";

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

const PROV_A = randomUUID(), PROV_B = randomUUID(), PROV_C = randomUUID();
const ENGINE = "fake-ocr/v1";
const NOTICE_V1 = "test-notice-v1", NOTICE_V2 = "test-notice-v2";

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
        policyVersion: "test-notice-v1",
        answer: null as unknown, // RegistrationReadResult
        calls: [] as { mimeType: string; bytes: ArrayBuffer; pages: { role: string; mimeType: string; bytes: ArrayBuffer }[] }[],
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
      // The signed-in BARQ user is the provider's own user row (seeded with the same id).
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
// The OCR ENGINE + its processing notice: a fake behind the real provider-neutral interface. It
// records what it was given and can be held mid-call. It is the only thing standing in for the
// external vendor; the notice version is controllable so stale consent can be proven.
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => {
  const reader = {
    engine: "fake-ocr/v1",
    inferenceGeo: "us",
    read: async (input: { pages: { role: string; bytes: ArrayBuffer; mimeType: string }[] }) => {
      // ONE call per SET: every page arrives in this one request, in order.
      const pages = input.pages.map((p) => ({ role: p.role, mimeType: p.mimeType, bytes: p.bytes.slice(0) }));
      state.ocr.calls.push({ mimeType: pages[0]!.mimeType, bytes: pages[0]!.bytes, pages });
      const gate = state.ocr.gate;
      if (gate) {
        state.ocr.gate = null; // holds exactly ONE call
        gate.entered();
        await gate.wait;
      }
      return state.ocr.answer;
    },
  };
  const policy = () => (state.ocr.enabled ? { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: state.ocr.policyVersion, inferenceGeo: "us" as const } : null);
  return {
    getRegistrationDocumentReader: () => (state.ocr.enabled ? reader : null),
    getRegistrationOcrPolicy: policy,
    getRegistrationOcrConfig: () => (state.ocr.enabled ? { provider: "claude", apiKey: "never-used-here", model: "fake", inferenceGeo: "us", policyVersion: state.ocr.policyVersion } : null),
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
const { decideRegistrationOcrConsent } = await import("@/lib/vehicles/registration-review/decide-ocr-consent");
const { replaceVehicleDocument } = await import("@/lib/vehicles/documents/replace-vehicle-document");
const { uploadVehicleDocument } = await import("@/lib/vehicles/documents/upload-vehicle-document");
const { computeRegistrationSetHash } = await import("@/lib/vehicles/registration-extraction/registration-document-set");
const { logger } = await import("@/lib/logger");

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
  inferenceGeo: "us",
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

function uploadRequest(requestKey: string, body: ArrayBuffer, type = "image/jpeg", name = "IMG_0001.jpg", back?: ArrayBuffer) {
  const form = new FormData();
  form.set("locale", "en");
  form.set("requestKey", requestKey);
  form.set("file", new File([body], name, { type }));
  if (back) form.set("back", new File([back], "IMG_0002.jpg", { type: "image/jpeg" }));
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", { method: "POST", body: form, headers: { accept: "application/json" } });
}
type Json = { ok: boolean; redirectTo?: string; replayed?: boolean; error?: string };
const idOf = (json: Json) => json.redirectTo!.split("/").pop()!.split("?")[0]!;
async function upload(provider: string, key: string, body: ArrayBuffer, type?: string, name?: string, back?: ArrayBuffer) {
  const res = await as(provider, () => POST(uploadRequest(key, body, type, name, back)));
  return { status: res.status, json: (await res.json()) as Json };
}
/** The provider's choice on the review step — the ONLY way an external reading can start. */
const grant = (provider: string, id: string, locale = "en") => as(provider, () => decideRegistrationOcrConsent(id, "GRANTED", { ownerAuthorizationConfirmed: true, locale }));
const decline = (provider: string, id: string, locale = "en") => as(provider, () => decideRegistrationOcrConsent(id, "DECLINED", { ownerAuthorizationConfirmed: false, locale }));
/** Upload a photo/scan, then consent — the normal "read automatically" journey. */
async function uploadAndRead(provider: string, key: string, body: ArrayBuffer, type?: string, name?: string) {
  const up = await upload(provider, key, body, type, name);
  const id = idOf(up.json);
  const granted = await grant(provider, id);
  return { ...up, id, granted };
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
type ExtRow = { id: string; status: string; source: string; ocrEngine: string | null; ocrInferenceGeo: string | null; ocrCallCount: number | null; failureCode: string | null; fields: Record<string, { normalizedValue: unknown; confidence: string; warnings: string[] }> | null; warnings: string[] | null; attemptCount: number; processingToken: string | null; documentSha256: string };
const extractionsFor = (assetId: string) =>
  q<ExtRow>(`SELECT id, status::text, source, "ocrEngine", "ocrInferenceGeo", "ocrCallCount", "failureCode", fields, warnings, "attemptCount", "processingToken"::text, "documentSha256" FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, assetId);
type ConsentRow = { id: string; providerId: string; userId: string; assetId: string | null; assetDocumentId: string | null; documentSha256: string | null; decision: string; policyVersion: string; processor: string; purpose: string; inferenceGeo: string | null; locale: string; ownerAuthorizationConfirmed: boolean };
const consentsFor = (assetId: string) =>
  q<ConsentRow>(`SELECT id::text, "providerId"::text, "userId"::text, "assetId"::text, "assetDocumentId"::text, "documentSha256", decision::text, "policyVersion", processor, purpose, "inferenceGeo", locale, "ownerAuthorizationConfirmed" FROM "vehicle_registration_ocr_consents" WHERE "assetId"=$1::uuid ORDER BY "createdAt", id`, assetId);
/** Audits of real engine readings (an engine was involved) — gate outcomes that sent nothing are not these. */
const ocrReadAudits = (assetId: string) => n(`SELECT count(*)::int n FROM "audit_logs" WHERE action='vehicle.registration_extracted' AND "entityId"=$1::uuid AND ("newValue"->>'aiAssisted')='true'`, assetId);
const consentAudits = (assetId: string, kind: "granted" | "declined") => n(`SELECT count(*)::int n FROM "audit_logs" WHERE action=$2 AND "entityId"=$1::uuid`, assetId, `vehicle.registration_ocr_consent_${kind}`);
const assetExists = async (id: string) => (await n(`SELECT count(*)::int n FROM "assets" WHERE id=$1::uuid`, id)) === 1;
const docIdOf = async (assetId: string, type = "VEHICLE_REGISTRATION") => (await q<{ id: string }>(`SELECT id::text FROM "asset_documents" WHERE "assetId"=$1::uuid AND type=$2`, assetId, type))[0]!.id;
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
    for (const id of [PROV_A, PROV_B, PROV_C]) {
      // The consent table's userId has a REAL foreign key: seed a user row with the same id as the
      // provider (the fake session reports that id as the signed-in BARQ user).
      await tx.$executeRawUnsafe(`INSERT INTO "users" ("id","createdAt","updatedAt") VALUES ($1::uuid,now(),now())`, id);
      await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$1::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, id);
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
  state.ocr.policyVersion = NOTICE_V1;
  state.ocr.answer = READ();
  state.ocr.calls.length = 0;
  state.ocr.gate = null;
  process.env.RATE_LIMIT_REGISTRATION_OCR_MAX = "1000";
});

describe.skipIf(!RUN)("registration OCR lifecycle + privacy gate — real PostgreSQL", () => {
  it("schema: PROCESSING exists, the lease/engine/geo/count columns are nullable, the checksum index is present, and the consent table has its FKs (SET NULL on asset + document)", async () => {
    const labels = (await q<{ l: string }>(`SELECT e.enumlabel l FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='VehicleRegistrationExtractionStatus' ORDER BY e.enumsortorder`)).map((r) => r.l);
    expect(labels).toEqual(["EXTRACTED", "NEEDS_REVIEW", "FAILED", "PROCESSING"]);
    const cols = await q<{ column_name: string; is_nullable: string }>(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='vehicle_registration_extractions' AND column_name IN ('ocrEngine','processingToken','processingExpiresAt','ocrCallCount','ocrInferenceGeo') ORDER BY 1`);
    expect(cols).toEqual([{ column_name: "ocrCallCount", is_nullable: "YES" }, { column_name: "ocrEngine", is_nullable: "YES" }, { column_name: "ocrInferenceGeo", is_nullable: "YES" }, { column_name: "processingExpiresAt", is_nullable: "YES" }, { column_name: "processingToken", is_nullable: "YES" }]);
    expect(await n(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='vehicle_registration_extractions_documentSha256_idx'`)).toBe(1);
    const fks = await q<{ conname: string; def: string }>(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='vehicle_registration_ocr_consents'::regclass AND contype='f' ORDER BY 1`);
    expect(fks.map((f) => f.conname)).toEqual(["vehicle_registration_ocr_consents_assetDocumentId_fkey", "vehicle_registration_ocr_consents_assetId_fkey", "vehicle_registration_ocr_consents_providerId_fkey", "vehicle_registration_ocr_consents_userId_fkey"]);
    expect(fks.find((f) => f.conname.includes("assetId_fkey"))!.def).toContain("ON DELETE SET NULL");
    expect(fks.find((f) => f.conname.includes("assetDocumentId_fkey"))!.def).toContain("ON DELETE SET NULL");
    expect(fks.find((f) => f.conname.includes("providerId_fkey"))!.def).toContain("ON DELETE RESTRICT");
  });

  it("NO CONSENT → ZERO outbound requests: a photo upload stores the document and waits for the provider's choice; nothing is read, nothing is invented, manual entry is open", async () => {
    const { status, json } = await upload(PROV_A, newKey(), await photo(1));
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, replayed: false });
    const id = idOf(json);
    expect(state.ocr.calls).toEqual([]);
    const ext = (await extractionsFor(id))[0]!;
    expect(ext).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED", source: "OCR", ocrEngine: null, ocrInferenceGeo: null, fields: null, processingToken: null });
    expect(ext.ocrCallCount ?? 0).toBe(0);
    expect(await consentsFor(id)).toEqual([]);
    expect(await ocrReadAudits(id)).toBe(0);
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.reviewState).toMatchObject({ extraction: "AWAITING_CONSENT", canAnalyze: false, canConfirm: true, failureLabelKey: null });
    expect(review!.ocrConsent).toEqual({ state: "NONE", policyVersion: NOTICE_V1, processor: "anthropic", inferenceGeo: "us" });
    expect(review!.fields.every((f) => f.extractedValue === null)).toBe(true);
    // Re-running the analysis (reload, retry, replay) still sends nothing.
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT", failureLabelKey: null });
    expect(state.ocr.calls).toEqual([]);
  }, 60_000);

  it("CONSENT → ONE reading: the decision is recorded durably (who, what, which notice, attestation, geography, language) BEFORE the call; the result is a suggestion the provider confirms", async () => {
    state.ocr.answer = READ({ manufactureYear: [{ text: "2020" }], plateNumber: [{ text: "T 55001", unclear: true }] });
    const { id, granted } = await uploadAndRead(PROV_A, newKey(), await photo(2), undefined, undefined);
    expect(granted).toMatchObject({ ok: true, decision: "GRANTED", analysis: { ok: true, status: "NEEDS_REVIEW" } });

    expect(state.ocr.calls).toHaveLength(1);
    const ext = (await extractionsFor(id))[0]!;
    expect(ext).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE, ocrInferenceGeo: "us", ocrCallCount: 1, failureCode: null, processingToken: null });
    expect(Object.values(ext.fields!).some((f) => f.confidence === "HIGH")).toBe(false); // never "verified"
    expect(await ocrReadAudits(id)).toBe(1);

    // The durable proof of consent — and only what proof needs.
    const consents = await consentsFor(id);
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ providerId: PROV_A, userId: PROV_A, assetId: id, assetDocumentId: await docIdOf(id), documentSha256: ext.documentSha256, decision: "GRANTED", policyVersion: NOTICE_V1, processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", inferenceGeo: "us", locale: "en", ownerAuthorizationConfirmed: true });
    expect(await consentAudits(id, "granted")).toBe(1);

    // Nothing was written to the vehicle: OCR never finalizes.
    expect(Object.values(await vehicleRow(id)).every((v) => v === null)).toBe(true);

    // The review read model: prefilled, sourced, flagged for review; consent shows GRANTED.
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review).toMatchObject({ extractionSource: "OCR", documentMimeType: "image/jpeg" });
    expect(review!.ocrConsent!.state).toBe("GRANTED");
    expect(review!.reviewState).toMatchObject({ extraction: "NEEDS_REVIEW", canConfirm: true });
    const field = (k: string) => review!.fields.find((f) => f.key === k)!;
    expect(field("modelYear")).toMatchObject({ extractedValue: 2020, source: "OCR", needsReview: true, confidence: "MEDIUM" });
    expect(field("plateNumber")).toMatchObject({ extractedValue: "T 55001", source: "OCR", needsReview: true, confidence: "LOW" });
    expect(field("bookablePassengerCapacity")).toMatchObject({ extractedValue: null, source: "UNRESOLVED", needsReview: true });
    expect(field("registeredSeats")).toMatchObject({ extractedValue: null, source: "UNRESOLVED" });

    // The provider CORRECTS the year and confirms → the vehicle carries the CONFIRMED values.
    const done = await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed({ modelYear: "2021", plateNumber: "T 55001" })));
    expect(done).toMatchObject({ ok: true, vehicleId: id });
    expect(await vehicleRow(id)).toMatchObject({ make: "Toyota", modelYear: 2021, registrationNumber: "T 55001", bookablePassengerCapacity: 5, registeredSeats: 8 });
  }, 60_000);

  it("DECLINE → manual entry: recorded as a decline, nothing is ever sent (even on a later re-analysis), and the provider finishes the SAME shell by hand", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(3));
    const id = idOf(json);
    expect(await decline(PROV_A, id, "ar")).toEqual({ ok: true, decision: "DECLINED", analysis: null });
    expect(state.ocr.calls).toEqual([]);
    const consents = await consentsFor(id);
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ decision: "DECLINED", inferenceGeo: null, documentSha256: null, ownerAuthorizationConfirmed: false, locale: "ar", policyVersion: NOTICE_V1 });
    expect(await consentAudits(id, "declined")).toBe(1);
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.ocrConsent!.state).toBe("DECLINED");
    expect(review!.reviewState).toMatchObject({ extraction: "AWAITING_CONSENT", canConfirm: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toEqual([]);
    const assetsBefore = await tableCount("assets");
    expect(await as(PROV_A, () => writeRegistrationConfirmation("DRAFT", id, { make: "Toyota" }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: true, vehicleId: id });
    expect(await tableCount("assets")).toBe(assetsBefore); // no other shell was created
    expect((await vehicleRow(id)).make).toBe("Toyota");
    expect(state.ocr.calls).toEqual([]); // still nothing, ever
  }, 60_000);

  it("CHANGING ONE'S MIND is append-only: decline → grant → the newest decision wins and the reading starts; the decline row is kept", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(4));
    const id = idOf(json);
    await decline(PROV_A, id);
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, decision: "GRANTED", analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    expect((await consentsFor(id)).map((c) => c.decision)).toEqual(["DECLINED", "GRANTED"]);
  }, 60_000);

  it("a GRANT without the owner/authorized attestation writes nothing and sends nothing", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(5));
    const id = idOf(json);
    expect(await as(PROV_A, () => decideRegistrationOcrConsent(id, "GRANTED", { ownerAuthorizationConfirmed: false, locale: "en" }))).toEqual({ ok: false, code: "OWNER_AUTHORIZATION_REQUIRED" });
    expect(await consentsFor(id)).toEqual([]);
    expect(state.ocr.calls).toEqual([]);
  }, 60_000);

  it("STALE NOTICE: consent given for notice v1 does not cover notice v2 — the provider is asked again and nothing is sent until they agree anew", async () => {
    state.ocr.answer = { ok: false, code: "OCR_TIMEOUT" }; // the first reading fails, so a retry will be needed
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(6));
    expect(state.ocr.calls).toHaveLength(1);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_TIMEOUT" });

    state.ocr.policyVersion = NOTICE_V2; // the operator changed the processing notice
    state.ocr.answer = READ();
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1); // the retry did NOT read under the old consent
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.ocrConsent).toMatchObject({ state: "STALE", policyVersion: NOTICE_V2 });
    expect(review!.reviewState.extraction).toBe("AWAITING_CONSENT");

    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(2);
    expect((await consentsFor(id)).map((c) => c.policyVersion)).toEqual([NOTICE_V1, NOTICE_V2]);
  }, 60_000);

  it("ONE PROVIDER'S CONSENT NEVER UNLOCKS ANOTHER'S DOCUMENT: identical bytes, B consents, A's copy still waits; B cannot decide for A's vehicle", async () => {
    const body = await photo(7);
    const a = await upload(PROV_A, newKey(), body);
    const b = await uploadAndRead(PROV_B, newKey(), body);
    expect(state.ocr.calls).toHaveLength(1); // B's reading only
    expect((await extractionsFor(idOf(a.json)))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    expect(await as(PROV_A, () => runRegistrationAnalysis(idOf(a.json)))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1); // and A's identical bytes were NOT served from B's result either
    expect(await as(PROV_B, () => decideRegistrationOcrConsent(idOf(a.json), "GRANTED", { ownerAuthorizationConfirmed: true, locale: "en" }))).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(await consentsFor(idOf(a.json))).toEqual([]);
    expect(await consentsFor(b.id)).toHaveLength(1);
  }, 60_000);

  it("a REPLACEMENT DOCUMENT needs its own consent: the decision is bound to the exact stored bytes, and the new bytes are never sent on the old decision", async () => {
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(8));
    expect(state.ocr.calls).toHaveLength(1);
    const docId = await docIdOf(id);
    const replacementBytes = await photo(9);
    const replaced = await as(PROV_A, () => replaceVehicleDocument(id, docId, { originalFilename: "IMG_0002.jpg", declaredMimeType: "image/jpeg", bytes: replacementBytes }));
    expect(replaced).toMatchObject({ ok: true });
    // The upload route's replace handler re-runs the analysis; do the same here.
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1); // the new bytes were NOT read on the old consent
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.ocrConsent!.state).toBe("NONE");
    expect(review!.reviewState.extraction).toBe("AWAITING_CONSENT");
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(2);
    const consents = await consentsFor(id);
    expect(consents).toHaveLength(2);
    expect(consents[0]!.documentSha256).not.toBe(consents[1]!.documentSha256); // two different documents, two decisions
    expect(consents[1]!.documentSha256).toBe((await extractionsFor(id))[0]!.documentSha256);
  }, 60_000);

  it("a ROTATED photo reaches the OCR engine UPRIGHT and without metadata (the stored, normalized bytes are what is read)", async () => {
    const original = await photo(10, 6); // 910×600 pixels tagged "rotate 90°"
    const { id } = await uploadAndRead(PROV_A, newKey(), original);
    const given = state.ocr.calls[0]!;
    expect(given.mimeType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(given.bytes)).metadata();
    expect(meta).toMatchObject({ width: 600, height: 910 });
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(sha(given.bytes)).toBe((await extractionsFor(id))[0]!.documentSha256); // the checksum is of exactly what was read
    expect(sha(given.bytes)).not.toBe(sha(original));
  }, 60_000);

  it("a NATIVE-TEXT PDF never touches the OCR engine and never needs a decision, even when one is configured", async () => {
    const { json } = await upload(PROV_A, newKey(), buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]), "application/pdf", "reg.pdf");
    expect(state.ocr.calls).toEqual([]);
    const id = idOf(json);
    const ext = (await extractionsFor(id))[0]!;
    expect(ext).toMatchObject({ source: "NATIVE_PDF_TEXT", ocrEngine: null, ocrInferenceGeo: null });
    expect(["EXTRACTED", "NEEDS_REVIEW"]).toContain(ext.status); // read locally — never a gate outcome
    expect(["EXTRACTED", "NEEDS_REVIEW"]).toContain((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState.extraction);
    expect(await consentsFor(id)).toEqual([]);
  });

  it("a SCANNED (image-only) PDF waits for the choice, then falls back to OCR and is handed over as a PDF", async () => {
    const { json } = await upload(PROV_A, newKey(), buildSyntheticPdf([null]), "application/pdf", "scan.pdf");
    const id = idOf(json);
    expect(state.ocr.calls).toEqual([]);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    expect(state.ocr.calls[0]!.mimeType).toBe("application/pdf");
    expect(state.ocr.calls[0]!.bytes.byteLength).toBeGreaterThan(0);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR" });
  });

  it("SIMULTANEOUS duplicate uploads → one shell, one document; SIMULTANEOUS decisions → ONE OCR call, one extraction, one reading audit", async () => {
    for (let round = 0; round < 5; round++) {
      state.ocr.calls.length = 0;
      state.ocr.answer = READ();
      const key = newKey();
      const body = await photo(20 + round);
      const [a, b] = await Promise.all([upload(PROV_A, key, body), upload(PROV_A, key, body)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(idOf(a.json)).toBe(idOf(b.json));
      const id = idOf(a.json);
      expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "assetId"=$1::uuid`, id)).toBe(1);
      expect(state.ocr.calls).toEqual([]);
      const [g1, g2] = await Promise.all([grant(PROV_A, id), grant(PROV_A, id)]);
      expect(g1.ok && g2.ok).toBe(true);
      expect(state.ocr.calls).toHaveLength(1);
      const rows = await extractionsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "NEEDS_REVIEW", processingToken: null, ocrCallCount: 1 });
      expect(await ocrReadAudits(id)).toBe(1);
    }
  }, 120_000);

  it("RELOAD / LOST RESPONSE: replaying the same key (and re-running the analysis) never repeats the OCR call and never spends budget again", async () => {
    const key = newKey();
    const body = await photo(30);
    const { id } = await uploadAndRead(PROV_A, key, body);
    expect(state.ocr.calls).toHaveLength(1);
    for (let i = 0; i < 3; i++) expect((await upload(PROV_A, key, body)).json).toEqual({ ok: true, redirectTo: `/provider/vehicles/new/${id}?resumed=1`, replayed: true });
    for (let i = 0; i < 2; i++) expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(state.ocr.calls).toHaveLength(1);
    expect(await ocrReadAudits(id)).toBe(1);
    expect((await extractionsFor(id))[0]).toMatchObject({ ocrCallCount: 1 });
  }, 60_000);

  it("OCR TIMEOUT leaves everything retryable: the document, shell and consent are kept, a retry reads it once more, no second shell", async () => {
    state.ocr.answer = { ok: false, code: "OCR_TIMEOUT" };
    const key = newKey();
    const { status, id } = await uploadAndRead(PROV_A, key, await photo(31));
    expect(status).toBe(200); // the UPLOAD succeeded; the reading did not
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_TIMEOUT", fields: null, ocrCallCount: 1 });
    expect(await assetExists(id)).toBe(true);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "assetId"=$1::uuid`, id)).toBe(1);
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.reviewState).toMatchObject({ extraction: "FAILED", canAnalyze: true, canConfirm: true, failureLabelKey: "vehicleRegExtractFailOcrTimeout" });
    expect(review!.ocrConsent!.state).toBe("GRANTED");

    state.ocr.answer = READ();
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(state.ocr.calls).toHaveLength(2);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "NEEDS_REVIEW", ocrCallCount: 2 });
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key)).toBe(1);
    expect((await upload(PROV_A, key, await photo(31))).json).toMatchObject({ ok: true, replayed: true }); // still the same shell
  }, 60_000);

  it("MANUAL ENTRY after a failed reading: the provider can finish the SAME shell without any OCR result", async () => {
    state.ocr.answer = { ok: false, code: "OCR_PROVIDER_ERROR" };
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(32));
    const assetsBefore = await tableCount("assets");
    expect(await as(PROV_A, () => writeRegistrationConfirmation("DRAFT", id, { make: "Toyota" }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: true, vehicleId: id });
    expect(await tableCount("assets")).toBe(assetsBefore);
    expect((await vehicleRow(id)).make).toBe("Toyota");
  }, 60_000);

  it("MALFORMED engine answer → FAILED, nothing of it is stored", async () => {
    state.ocr.answer = { ok: false, code: "OCR_MALFORMED_RESPONSE" };
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(33));
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_MALFORMED_RESPONSE", fields: null, warnings: null });
  }, 60_000);

  it("GEOGRAPHY MISMATCH reported by the reader → FAILED, nothing stored, audited with the configured geography and no observed one; no fallback call", async () => {
    state.ocr.answer = { ok: false, code: "OCR_GEO_MISMATCH" };
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(34));
    expect(state.ocr.calls).toHaveLength(1);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_GEO_MISMATCH", fields: null, ocrInferenceGeo: null, processingToken: null });
    const audit = (await q<{ v: Record<string, unknown> }>(`SELECT "newValue" v FROM "audit_logs" WHERE action='vehicle.registration_extracted' AND "entityId"=$1::uuid AND ("newValue"->>'failureCode')='OCR_GEO_MISMATCH'`, id))[0]!.v;
    expect(audit).toMatchObject({ aiAssisted: true, ocrEngine: ENGINE, inferenceGeo: "us", observedInferenceGeo: null });
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "FAILED", failureLabelKey: "vehicleRegExtractFailOcrUnavailable", canConfirm: true });
  }, 60_000);

  it("INVALID values from the engine are unresolved, and the SAME server validators reject them if a provider submits them", async () => {
    state.ocr.answer = READ({ manufactureYear: [{ text: "2099" }], licensedPassengerCapacity: [{ text: "0" }] });
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(35));
    const ext = (await extractionsFor(id))[0]!;
    expect(ext.fields!.manufactureYear).toMatchObject({ normalizedValue: null, confidence: "LOW" });
    expect(ext.fields!.licensedPassengerCapacity).toMatchObject({ normalizedValue: null });
    const rejected = await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed({ modelYear: "2099", licensedPassengerCapacity: "0" })));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("INVALID_INPUT");
    expect(Object.values(await vehicleRow(id)).every((v) => v === null)).toBe(true);
  }, 60_000);

  it("CANCELLATION WHILE OCR IS RUNNING: the late answer is discarded — no extraction, no reading audit, no resurrection; the consent proof survives with its links nulled", async () => {
    const key = newKey();
    const { json } = await upload(PROV_A, key, await photo(40));
    const id = idOf(json);
    const hold = holdNextOcrCall();
    const granting = grant(PROV_A, id);
    await hold.inFlight; // consent recorded, the OCR call is in flight
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "PROCESSING" });
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "PROCESSING", canConfirm: false, canAnalyze: false });
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: false, code: "EXTRACTION_NOT_READY" });

    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true });
    expect(await assetExists(id)).toBe(false);

    hold.release(); // the engine answers — far too late
    await granting;

    expect(await assetExists(id)).toBe(false); // not resurrected
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id)).toBe(0);
    expect(await ocrReadAudits(id)).toBe(0); // a discarded answer is not audited as a reading
    expect((await q<{ status: string; assetId: string | null }>(`SELECT status::text, "assetId"::text FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key))[0]).toEqual({ status: "CANCELLED", assetId: null });
    expect(await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "x.jpg", declaredMimeType: "image/jpeg", bytes: new ArrayBuffer(8) }))).toEqual({ ok: false, error: "ONBOARDING_CANCELLED" });
    expect([...state.storage.keys()].some((k) => k.includes(id))).toBe(false); // the stored document was removed too
    // The proof of consent OUTLIVES the setup: the row remains, its asset/document links are NULL.
    const proof = await q<ConsentRow>(`SELECT id::text, "providerId"::text, "userId"::text, "assetId"::text, "assetDocumentId"::text, "documentSha256", decision::text, "policyVersion", processor, purpose, "inferenceGeo", locale, "ownerAuthorizationConfirmed" FROM "vehicle_registration_ocr_consents" WHERE "providerId"=$1::uuid AND "assetId" IS NULL`, PROV_A);
    expect(proof.length).toBeGreaterThanOrEqual(1);
    expect(proof.every((p) => p.assetDocumentId === null && p.decision === "GRANTED" && p.policyVersion === NOTICE_V1)).toBe(true);
  }, 60_000);

  it("a request arriving WHILE the document is being read does not start a second reading", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(41));
    const id = idOf(json);
    const hold = holdNextOcrCall();
    const granting = grant(PROV_A, id);
    await hold.inFlight;
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "PROCESSING" });
    expect(state.ocr.calls).toHaveLength(1);
    hold.release();
    await granting;
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "NEEDS_REVIEW" });
    expect(state.ocr.calls).toHaveLength(1);
  }, 60_000);

  it("a STALLED reading (expired lease) is taken over; the stalled attempt's late answer is discarded, the newer result stands", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(42));
    const id = idOf(json);
    state.ocr.answer = READ({ model: [{ text: "StaleAnswer" }] });
    const hold = holdNextOcrCall();
    const granting = grant(PROV_A, id);
    await hold.inFlight;
    await db.$executeRawUnsafe(`UPDATE "vehicle_registration_extractions" SET "processingExpiresAt"=now() - interval '1 second' WHERE "assetId"=$1::uuid`, id);
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "FAILED", canAnalyze: true, canConfirm: true, failureLabelKey: "vehicleRegExtractFailOcrTimeout" });

    state.ocr.answer = READ({ model: [{ text: "FreshAnswer" }] });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    hold.release();
    await granting;

    const ext = (await extractionsFor(id))[0]!;
    expect(ext.fields!.model!.normalizedValue).toBe("FreshAnswer"); // never overwritten by the stale answer
    expect(ext).toMatchObject({ status: "NEEDS_REVIEW", ocrCallCount: 2, processingToken: null });
    expect(await ocrReadAudits(id)).toBe(1);
  }, 60_000);

  it("AUDIT FAILURE while completing → the extraction is NOT marked complete, stays retryable, and a retry succeeds", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(50));
    const id = idOf(json);
    state.failExtractionAuditOnce = true;
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: false, code: "EXTRACTION_FAILED" } });
    const failed = (await extractionsFor(id))[0]!;
    expect(failed).toMatchObject({ status: "FAILED", failureCode: "EXTRACTION_FAILED", fields: null, processingToken: null });
    expect(await ocrReadAudits(id)).toBe(0); // no "read" audit for something that did not complete
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ canAnalyze: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(await ocrReadAudits(id)).toBe(1);
  }, 60_000);

  it("STORAGE FAILURE while reading the stored document → nothing is recorded; a grant has nothing to bind to yet; once storage works the choice is offered", async () => {
    state.downloadMode = "fail";
    const { status, json } = await upload(PROV_A, newKey(), await photo(51));
    expect(status).toBe(200);
    const id = idOf(json);
    expect(await extractionsFor(id)).toHaveLength(0);
    expect(state.ocr.calls).toEqual([]);
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState).toMatchObject({ extraction: "NOT_ANALYZED", canAnalyze: true });
    expect(await grant(PROV_A, id)).toEqual({ ok: false, code: "EXTRACTION_NOT_READY" });
    expect(await consentsFor(id)).toEqual([]);
    state.downloadMode = "ok";
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toEqual([]);
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(await extractionsFor(id)).toHaveLength(1);
  }, 60_000);

  it("the SAME onboarding key under TWO PROVIDERS, uploading IDENTICAL bytes → two shells and two readings (nothing is shared across providers)", async () => {
    const key = newKey();
    const body = await photo(60);
    const a = await uploadAndRead(PROV_A, key, body);
    const b = await uploadAndRead(PROV_B, key, body);
    expect(a.id).not.toBe(b.id);
    expect(a.json.replayed).toBe(false);
    expect(b.json.replayed).toBe(false);
    expect(state.ocr.calls).toHaveLength(2);
    expect(sha(state.ocr.calls[0]!.bytes)).toBe(sha(state.ocr.calls[1]!.bytes));
    const [ea, eb] = [(await extractionsFor(a.id))[0]!, (await extractionsFor(b.id))[0]!];
    expect(ea.warnings ?? []).not.toContain("REUSED_IDENTICAL_DOCUMENT");
    expect(eb.warnings ?? []).not.toContain("REUSED_IDENTICAL_DOCUMENT");
    expect(await as(PROV_B, () => getRegistrationReview(a.id))).toBeNull();
  }, 60_000);

  it("the SAME document under two legitimate onboarding keys of ONE provider → two shells, two decisions, ONE reading (reused by checksum, and only after consent)", async () => {
    const body = await photo(61);
    state.ocr.answer = READ({ model: [{ text: "SharedRead" }] });
    const first = await uploadAndRead(PROV_A, newKey(), body);
    state.ocr.answer = READ({ model: [{ text: "MustNotBeCalled" }] });
    const second = await upload(PROV_A, newKey(), body);
    const secondId = idOf(second.json);
    expect(secondId).not.toBe(first.id);
    // Without consent for THIS setup, not even the stored result is reused.
    expect((await extractionsFor(secondId))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED", fields: null });
    expect(await grant(PROV_A, secondId)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    const e2 = (await extractionsFor(secondId))[0]!;
    expect(e2).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE, ocrInferenceGeo: "us" });
    expect(e2.fields!.model!.normalizedValue).toBe("SharedRead");
    expect(e2.warnings).toContain("REUSED_IDENTICAL_DOCUMENT");
    expect(await ocrReadAudits(secondId)).toBe(1); // each setup has its own audit
  }, 60_000);

  it("CALL BUDGET (real durable limiter): the third reading in the window is refused without a call; the limiter holds only opaque keys", async () => {
    process.env.RATE_LIMIT_REGISTRATION_OCR_MAX = "2";
    const one = await uploadAndRead(PROV_C, newKey(), await photo(70));
    const two = await uploadAndRead(PROV_C, newKey(), await photo(71));
    expect(one.granted).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(two.granted).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    const three = await uploadAndRead(PROV_C, newKey(), await photo(72));
    expect(three.granted).toMatchObject({ ok: true, analysis: { ok: true, status: "FAILED", failureLabelKey: "vehicleRegExtractFailOcrRateLimited" } });
    expect(state.ocr.calls).toHaveLength(2);
    expect((await extractionsFor(three.id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_RATE_LIMITED", fields: null, processingToken: null });
    // A replay of the refused one spends nothing and reads nothing.
    expect(await as(PROV_C, () => runRegistrationAnalysis(three.id))).toMatchObject({ ok: true, status: "FAILED" });
    expect(state.ocr.calls).toHaveLength(2);
    const keys = (await q<{ key: string }>(`SELECT key FROM "auth_rate_limits" WHERE key LIKE 'registration-ocr:%' ORDER BY key`)).map((r) => r.key);
    expect(keys).toContain(`registration-ocr:provider:${PROV_C}`);
    expect(keys).toContain(`registration-ocr:user:${PROV_C}`);
    expect(keys.join(" ")).not.toMatch(/@|\+968|T \d{3}|IMG_/);
    process.env.RATE_LIMIT_REGISTRATION_OCR_MAX = "1000";
    // Manual entry remains available to a rate-limited provider.
    expect(await as(PROV_C, () => finalizeVehicleFromRegistration(three.id, confirmed()))).toMatchObject({ ok: true });
  }, 90_000);

  it("PER-DOCUMENT CEILING: at the limit of external-call attempts no further call is ever made (OCR_ATTEMPT_LIMIT), manual entry stays open", async () => {
    state.ocr.answer = { ok: false, code: "OCR_TIMEOUT" };
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(80));
    await db.$executeRawUnsafe(`UPDATE "vehicle_registration_extractions" SET "ocrCallCount"=5 WHERE "assetId"=$1::uuid`, id);
    state.ocr.answer = READ();
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "FAILED", failureLabelKey: "vehicleRegExtractFailOcrAttemptLimit" });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "FAILED", failureLabelKey: "vehicleRegExtractFailOcrAttemptLimit" });
    expect(state.ocr.calls).toHaveLength(1); // only the original timed-out attempt
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_ATTEMPT_LIMIT", ocrCallCount: 5 });
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: true });
  }, 60_000);

  it("DUPLICATE registration number is detected by the server and reveals nothing about the other provider's vehicle", async () => {
    const plate = "T 77001";
    const a = await uploadAndRead(PROV_A, newKey(), await photo(90));
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(a.id, confirmed({ plateNumber: plate })))).toMatchObject({ ok: true });
    const b = await uploadAndRead(PROV_B, newKey(), await photo(91));
    const dup = await as(PROV_B, () => finalizeVehicleFromRegistration(b.id, confirmed({ plateNumber: plate })));
    expect(dup).toEqual({ ok: false, code: "DUPLICATE_REGISTRATION" });
    expect(JSON.stringify(dup)).not.toContain(a.id);
    expect(Object.values(await vehicleRow(b.id)).every((v) => v === null)).toBe(true);
  }, 60_000);

  it("OCR NOT CONFIGURED: a photo is stored and goes to manual entry — nothing is sent, nothing is invented, there is nothing to consent to", async () => {
    state.ocr.enabled = false;
    const { status, json } = await upload(PROV_A, newKey(), await photo(100));
    expect(status).toBe(200);
    const id = idOf(json);
    expect(state.ocr.calls).toEqual([]);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_NOT_CONFIGURED", fields: null, ocrEngine: null });
    const review = await as(PROV_A, () => getRegistrationReview(id));
    expect(review!.extractionSource).toBeNull();
    expect(review!.ocrConsent).toBeNull();
    expect(review!.reviewState).toMatchObject({ extraction: "FAILED", canConfirm: true, failureLabelKey: "vehicleRegExtractFailOcrUnavailable" });
    expect(review!.fields.every((f) => f.extractedValue === null)).toBe(true);
    expect(await grant(PROV_A, id)).toEqual({ ok: false, code: "OCR_NOT_AVAILABLE" });
    expect(await consentsFor(id)).toEqual([]);
    expect(await as(PROV_A, () => finalizeVehicleFromRegistration(id, confirmed()))).toMatchObject({ ok: true });
  }, 60_000);

  it("nothing read by OCR appears in the audit trail, the consent proof, the onboarding request, the limiter or the cleanup outbox", async () => {
    state.ocr.answer = READ({ plateNumber: [{ text: "LEAK 12345" }], vin: [{ text: "LEAKV1N0000000009" }], makeDescription: [{ text: "LeakMake" }] });
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(110));
    await as(PROV_A, () => writeRegistrationConfirmation("DRAFT", id, { make: "LeakMake", plateNumber: "LEAK 12345" }));
    for (const needle of ["LEAK 12345", "LEAKV1N0000000009", "LeakMake"]) {
      expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE coalesce("previousValue"::text,'') LIKE $1 OR coalesce("newValue"::text,'') LIKE $1`, `%${needle}%`)).toBe(0);
      expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey" LIKE $1`, `%${needle}%`)).toBe(0);
      expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_ocr_consents" c WHERE row_to_json(c)::text LIKE $1`, `%${needle}%`)).toBe(0);
      expect(await n(`SELECT count(*)::int n FROM "auth_rate_limits" WHERE key LIKE $1`, `%${needle}%`)).toBe(0);
    }
    const audit = (await q<{ v: Record<string, unknown> }>(`SELECT "newValue" v FROM "audit_logs" WHERE action='vehicle.registration_extracted' AND "entityId"=$1::uuid AND ("newValue"->>'aiAssisted')='true'`, id))[0]!.v;
    expect(audit).toMatchObject({ source: "OCR", aiAssisted: true, ocrEngine: ENGINE, inferenceGeo: "us", observedInferenceGeo: "us", confidence: "SUGGESTION_REQUIRES_PROVIDER_REVIEW" });
    expect(Object.keys(audit).sort()).toEqual(["aiAssisted", "confidence", "failureCode", "fieldsNeedingReview", "fieldsRead", "inferenceGeo", "observedInferenceGeo", "ocrEngine", "pageCount", "parserVersion", "reason", "requestId", "source", "status"]);
  }, 60_000);

  it("the server log never carried a request/response body, a document value, a key or an image: only event names, ids and error categories", () => {
    const calls = (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const text = JSON.stringify(calls);
    expect(text).not.toMatch(/data:image|base64|\/9j\/|Toyota|Testcruiser|LEAK|TESTV1N|T 5500|sk-ant|x-api-key|inference_geo|"content":|candidates/);
    for (const call of calls) {
      const [event, fields] = call as [string, Record<string, unknown> | undefined];
      expect(event).toMatch(/^[a-zA-Z.]+(_[a-z]+)*$/);
      for (const v of Object.values(fields ?? {})) expect(["string", "number", "boolean", "undefined"].includes(typeof v) || v === null).toBe(true);
    }
  });

  it("no duplicate shell / document / extraction anywhere, and no Booking / reservation / offering / service / pricing / payment / vertical writes", async () => {
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetId" FROM "asset_documents" WHERE type='VEHICLE_REGISTRATION' GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetDocumentId" FROM "vehicle_registration_extractions" GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetId" FROM "vehicle_onboarding_requests" WHERE "assetId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_extractions" WHERE status='PROCESSING'`)).toBe(0); // nothing left mid-read
    expect(await n(`SELECT count(*)::int n FROM (SELECT "entityId" FROM "audit_logs" WHERE action='vehicle.onboarding_draft_created' GROUP BY 1 HAVING count(*) > 1) d`)).toBe(0);
    // Every reading that happened had a GRANTED decision for its exact bytes on record.
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_extractions" e WHERE e.source='OCR' AND e."ocrEngine" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "vehicle_registration_ocr_consents" c WHERE c."assetDocumentId"=e."assetDocumentId" AND c.decision='GRANTED' AND c."documentSha256"=e."documentSha256")`)).toBe(0);
    for (const t of ["bookings", "vehicle_reservations", "rental_vehicle_day_reservations", "rental_offerings", "guided_tour_vehicle_offerings", "services", "prices", "payments", "commissions", "provider_verticals", "provider_categories", "tour_service_vehicles"]) {
      expect(await tableCount(t), t).toBe(0);
    }
    // OCR approved nothing: no asset was activated or verified by any of the above.
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE status <> 'REGISTERED' OR "verificationStatus" = 'APPROVED'`)).toBe(0);
  });
});

describe.skipIf(!RUN)("registration document SET — one PDF | one photo | front + back photos (real PostgreSQL)", () => {
  const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => sha(a) === sha(b);

  it("TWO PHOTOS → one shell with TWO rows (front, back) committed together; the review lists both sides in order; nothing is read before the choice", async () => {
    const { status, json } = await upload(PROV_A, newKey(), await photo(201), undefined, undefined, await photo(202));
    expect(status).toBe(200);
    const id = idOf(json);
    const docs = await q<{ type: string; mimeType: string }>(`SELECT type, "mimeType" FROM "asset_documents" WHERE "assetId"=$1::uuid ORDER BY type`, id);
    expect(docs).toEqual([{ type: "VEHICLE_REGISTRATION", mimeType: "image/jpeg" }, { type: "VEHICLE_REGISTRATION_BACK", mimeType: "image/jpeg" }]);
    expect(state.ocr.calls).toEqual([]);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    const review = (await as(PROV_A, () => getRegistrationReview(id)))!;
    expect(review.setKind).toBe("IMAGES");
    expect(review.pages.map((p) => p.role)).toEqual(["FRONT", "BACK"]);
    expect(review.reviewState.extraction).toBe("AWAITING_CONSENT");
    expect(await consentsFor(id)).toEqual([]);
  }, 60_000);

  it("CONSENT for the set → ONE call carrying BOTH pages in order; the consent, the extraction and the audit are bound to the ORDERED SET hash (not to one file); a replay reads nothing again", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(203), undefined, undefined, await photo(204));
    const id = idOf(json);
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    const given = state.ocr.calls[0]!;
    expect(given.pages.map((p) => p.role)).toEqual(["FRONT", "BACK"]);
    expect(given.pages.map((p) => p.mimeType)).toEqual(["image/jpeg", "image/jpeg"]);
    const setHash = computeRegistrationSetHash(given.pages.map((p) => sha(p.bytes)));
    expect(setHash).not.toBe(sha(given.pages[0]!.bytes));
    const ext = (await extractionsFor(id))[0]!;
    expect(ext).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE, documentSha256: setHash, ocrCallCount: 1 });
    expect((await consentsFor(id)).at(-1)!.documentSha256).toBe(setHash);
    expect(await ocrReadAudits(id)).toBe(1);
    const audit = (await q<{ v: Record<string, unknown> }>(`SELECT "newValue" v FROM "audit_logs" WHERE action='vehicle.registration_extracted' AND "entityId"=$1::uuid AND ("newValue"->>'aiAssisted')='true'`, id))[0]!.v;
    expect(audit).toMatchObject({ pageCount: 2 });
    // Reload / replay: answered from the stored result.
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(await as(PROV_A, () => grant(PROV_A, id))).toMatchObject({ ok: true });
    expect(state.ocr.calls).toHaveLength(1);
  }, 60_000);

  it("two SIMULTANEOUS analyses of a two-photo set under one consent → ONE call, one reading audit", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(205), undefined, undefined, await photo(206));
    const id = idOf(json);
    const { inFlight, release } = holdNextOcrCall();
    const first = grant(PROV_A, id);
    await inFlight;
    const second = await as(PROV_A, () => runRegistrationAnalysis(id));
    expect(second).toMatchObject({ ok: true, status: "PROCESSING" });
    release();
    expect(await first).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    expect(await ocrReadAudits(id)).toBe(1);
  }, 60_000);

  it("REPLACING the BACK side invalidates the consent AND the extraction: nothing is read until a fresh decision, which reads the NEW set once", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(207), undefined, undefined, await photo(208));
    const id = idOf(json);
    await grant(PROV_A, id);
    expect(state.ocr.calls).toHaveLength(1);
    const firstHash = (await extractionsFor(id))[0]!.documentSha256;
    const backId = await docIdOf(id, "VEHICLE_REGISTRATION_BACK");
    const newBack = await photo(209);
    expect(await as(PROV_A, () => replaceVehicleDocument(id, backId, { originalFilename: "IMG_0003.jpg", declaredMimeType: "image/jpeg", bytes: newBack }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1); // the old consent covered the OLD set only
    const stale = (await extractionsFor(id))[0]!;
    expect(stale.documentSha256).not.toBe(firstHash);
    expect(stale).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED", fields: null });
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.ocrConsent!.state).toBe("NONE");
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(2);
    expect(sameBytes(state.ocr.calls[1]!.pages[1]!.bytes, state.ocr.calls[0]!.pages[1]!.bytes)).toBe(false); // the new back was read
    expect(sameBytes(state.ocr.calls[1]!.pages[0]!.bytes, state.ocr.calls[0]!.pages[0]!.bytes)).toBe(true); // with the unchanged front
  }, 90_000);

  it("REPLACING the FRONT side likewise invalidates both — the stale back is never read with an old front", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(210), undefined, undefined, await photo(211));
    const id = idOf(json);
    await grant(PROV_A, id);
    const frontId = await docIdOf(id);
    const newFront = await photo(212);
    expect(await as(PROV_A, () => replaceVehicleDocument(id, frontId, { originalFilename: "IMG_0004.jpg", declaredMimeType: "image/jpeg", bytes: newFront }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1);
    await grant(PROV_A, id);
    expect(state.ocr.calls).toHaveLength(2);
    expect(sameBytes(state.ocr.calls[1]!.pages[0]!.bytes, state.ocr.calls[0]!.pages[0]!.bytes)).toBe(false);
    expect(sameBytes(state.ocr.calls[1]!.pages[1]!.bytes, state.ocr.calls[0]!.pages[1]!.bytes)).toBe(true);
  }, 90_000);

  it("ADDING a back side to a one-photo set already read is a NEW set: the earlier consent for the front alone does not cover it", async () => {
    const { id } = await uploadAndRead(PROV_A, newKey(), await photo(213));
    expect(state.ocr.calls).toHaveLength(1);
    expect(state.ocr.calls[0]!.pages).toHaveLength(1);
    const addedBack = await photo(214);
    expect(await as(PROV_A, () => uploadVehicleDocument(id, { type: "VEHICLE_REGISTRATION_BACK", originalFilename: "IMG_0005.jpg", declaredMimeType: "image/jpeg", bytes: addedBack }))).toMatchObject({ ok: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1);
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(2);
    expect(state.ocr.calls[1]!.pages.map((p) => p.role)).toEqual(["FRONT", "BACK"]);
    const consents = await consentsFor(id);
    expect(consents).toHaveLength(2);
    expect(consents[0]!.documentSha256).not.toBe(consents[1]!.documentSha256);
  }, 90_000);

  it("SWAPPING the sides (reorder) is a different set: consent given for front→back does not cover back→front", async () => {
    const a = await photo(215), b = await photo(216);
    const { json } = await upload(PROV_A, newKey(), a, undefined, undefined, b);
    const id = idOf(json);
    await grant(PROV_A, id);
    const firstHash = (await extractionsFor(id))[0]!.documentSha256;
    const frontId = await docIdOf(id), backId = await docIdOf(id, "VEHICLE_REGISTRATION_BACK");
    expect(await as(PROV_A, () => replaceVehicleDocument(id, frontId, { originalFilename: "swap-front.jpg", declaredMimeType: "image/jpeg", bytes: b }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => replaceVehicleDocument(id, backId, { originalFilename: "swap-back.jpg", declaredMimeType: "image/jpeg", bytes: a }))).toEqual({ ok: true });
    expect(await as(PROV_A, () => runRegistrationAnalysis(id))).toMatchObject({ ok: true, status: "AWAITING_CONSENT" });
    expect(state.ocr.calls).toHaveLength(1);
    expect((await extractionsFor(id))[0]!.documentSha256).not.toBe(firstHash);
    await grant(PROV_A, id);
    expect(state.ocr.calls).toHaveLength(2);
    // The second reading saw the pages in the NEW order.
    expect(sameBytes(state.ocr.calls[1]!.pages[0]!.bytes, state.ocr.calls[0]!.pages[1]!.bytes)).toBe(true);
    expect(sameBytes(state.ocr.calls[1]!.pages[1]!.bytes, state.ocr.calls[0]!.pages[0]!.bytes)).toBe(true);
  }, 120_000);

  it("a TEXT-LAYER PDF whose text yields nothing usable is NOT a dead end: the choice is offered, then ONE call with the PDF", async () => {
    const { json } = await upload(PROV_A, newKey(), buildSyntheticPdf([["Ministry of Transport", "Vehicle services", "Page 1 of 2"]]), "application/pdf", "cover.pdf");
    const id = idOf(json);
    expect(state.ocr.calls).toEqual([]);
    const ext = (await extractionsFor(id))[0]!;
    expect(ext).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    expect(ext.warnings).toContain("NATIVE_TEXT_UNUSABLE");
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.reviewState.extraction).toBe("AWAITING_CONSENT");
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    expect(state.ocr.calls[0]!.pages.map((p) => p.mimeType)).toEqual(["application/pdf"]);
    expect((await extractionsFor(id))[0]).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR" });
  }, 60_000);

  it("a SCANNED TWO-PAGE PDF → one call with ONE page object (the PDF) — never one call per printed page", async () => {
    const { json } = await upload(PROV_A, newKey(), buildSyntheticPdf([null, null]), "application/pdf", "scan2.pdf");
    const id = idOf(json);
    expect(await grant(PROV_A, id)).toMatchObject({ ok: true, analysis: { ok: true, status: "NEEDS_REVIEW" } });
    expect(state.ocr.calls).toHaveLength(1);
    expect(state.ocr.calls[0]!.pages).toHaveLength(1);
    expect(state.ocr.calls[0]!.pages[0]!.mimeType).toBe("application/pdf");
  }, 60_000);

  it("a THREE-PAGE PDF and a PDF + photo are refused at upload; nothing is stored and the key stays retryable", async () => {
    const key = newKey();
    const three = await upload(PROV_A, key, buildSyntheticPdf([["1"], ["2"], ["3"]]), "application/pdf", "three.pdf");
    expect(three).toMatchObject({ status: 400, json: { ok: false, error: "PDF_TOO_MANY_PAGES" } });
    const mixed = await upload(PROV_A, key, buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]), "application/pdf", "reg.pdf", await photo(217));
    expect(mixed).toMatchObject({ status: 400, json: { ok: false, error: "INVALID_DOCUMENT_SET" } });
    const ok = await upload(PROV_A, key, buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]), "application/pdf", "reg.pdf");
    expect(ok).toMatchObject({ status: 200, json: { ok: true, replayed: false } });
    expect(state.ocr.calls).toEqual([]); // native text — no call for a readable PDF
  }, 60_000);

  it("CANCELLING a two-photo setup removes BOTH objects and both rows; the consent proof survives with its links nulled", async () => {
    const { json } = await upload(PROV_A, newKey(), await photo(218), undefined, undefined, await photo(219));
    const id = idOf(json);
    await grant(PROV_A, id);
    const keys = (await q<{ k: string }>(`SELECT "objectKey" k FROM "asset_documents" WHERE "assetId"=$1::uuid`, id)).map((r) => r.k);
    expect(keys).toHaveLength(2);
    const { deleteDraftVehicle } = await import("@/lib/vehicles/onboarding/delete-draft-vehicle");
    expect(await as(PROV_A, () => deleteDraftVehicle(id))).toMatchObject({ ok: true });
    expect(await assetExists(id)).toBe(false);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "assetId"=$1::uuid`, id)).toBe(0);
    for (const k of keys) expect(state.storage.has(k)).toBe(false);
    const consents = await consentsFor(id);
    expect(consents).toEqual([]); // assetId was set NULL — the row still exists under the provider
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_ocr_consents" WHERE "providerId"=$1::uuid AND "assetId" IS NULL AND "assetDocumentId" IS NULL`, PROV_A)).toBeGreaterThan(0);
  }, 60_000);

  it("the back side never reaches the provider-verification document tables, and a set never has two of either side", async () => {
    expect(await tableCount("provider_documents")).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM (SELECT "assetId", type FROM "asset_documents" WHERE type IN ('VEHICLE_REGISTRATION','VEHICLE_REGISTRATION_BACK') GROUP BY 1, 2 HAVING count(*) > 1) d`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" b WHERE b.type='VEHICLE_REGISTRATION_BACK' AND NOT EXISTS (SELECT 1 FROM "asset_documents" f WHERE f."assetId"=b."assetId" AND f.type='VEHICLE_REGISTRATION')`)).toBe(0); // no orphan back side
  });
});
