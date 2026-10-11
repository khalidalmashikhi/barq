import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildSyntheticPdf } from "@/lib/vehicles/documents/synthetic-test-documents";
import type { RegistrationReadResult } from "./ocr/registration-document-reader";

// Phase 3C (incomplete native-PDF correction, 2026-10-09) — REAL-PostgreSQL proof of the two
// recovery paths end to end: the real upload route → real native PDF text extraction → the real
// extraction service → the real review read model → the real "Read document again" and
// "Complete automatic reading" operations and consent decision. Substituted: the session, the
// storage bucket (in-memory) and the external READER (a controllable fake that never contacts
// anyone). Every document is synthetic (Latin text PDFs built in-test); no real registration.
//
// Gated behind REGISTRATION_DBPROOF=1 (run ALONE — never concurrently with a production build):
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/registration-extraction/registration-recovery.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";
process.env.RATE_LIMIT_REGISTRATION_OCR_MAX = "1000";

const PROJECT = process.cwd();
const dbName = "barq_recovery_dbproof_" + randomUUID().slice(0, 8);
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
const NOTICE = "2026-10-09-v2";

const { session, state } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage: ALS } = require("node:async_hooks") as typeof import("node:async_hooks");
  return {
    session: new ALS<string>(),
    state: {
      storage: new Map<string, ArrayBuffer>(),
      failCompletionAuditOnce: false,
      ocr: {
        policyVersion: "2026-10-09-v2",
        answer: null as unknown,
        calls: [] as { pages: { role: string; mimeType: string }[] }[],
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
      if (params.action === "vehicle.registration_completion" && state.failCompletionAuditOnce && (params.newValue as { outcome?: string }).outcome === "COMPLETED") {
        state.failCompletionAuditOnce = false;
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
      const body = state.storage.get(objectKey);
      if (!body) throw new Error("Object not found");
      return body.slice(0);
    },
    removePrivateObject: async (objectKey: string) => { state.storage.delete(objectKey); },
  };
});
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => {
  const reader = {
    engine: "fake-reader/v1",
    inferenceGeo: "us",
    read: async (input: { pages: { role: string; mimeType: string }[] }) => {
      state.ocr.calls.push({ pages: input.pages.map((p) => ({ role: p.role, mimeType: p.mimeType })) });
      const gate = state.ocr.gate;
      if (gate) {
        state.ocr.gate = null;
        gate.entered();
        await gate.wait;
      }
      return state.ocr.answer;
    },
  };
  const policy = () => ({ processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: state.ocr.policyVersion, inferenceGeo: "us" as const });
  return {
    getRegistrationDocumentReader: () => reader,
    getRegistrationOcrPolicy: policy,
    getRegistrationOcrConfig: () => ({ provider: "claude", apiKey: "never-used-here", model: "fake", inferenceGeo: "us", policyVersion: state.ocr.policyVersion }),
    isRegistrationOcrOperational: () => true,
    resolveRegistrationOcrProvider: () => "claude",
  };
});

const { POST } = await import("@/app/api/provider/vehicles/onboarding/upload/route");
const { cancelVehicleOnboardingRequest } = await import("@/lib/vehicles/onboarding/cancel-onboarding-request");
const { getRegistrationReview } = await import("@/lib/vehicles/registration-review/get-registration-review");
const { rereadRegistrationDocument } = await import("@/lib/vehicles/registration-review/reread-registration");
const { completeRegistrationReading } = await import("@/lib/vehicles/registration-review/complete-registration-reading");
const { decideRegistrationOcrConsent } = await import("@/lib/vehicles/registration-review/decide-ocr-consent");
const { writeRegistrationConfirmation } = await import("@/lib/vehicles/registration-review/write-confirmation");
const { runRegistrationAnalysis } = await import("@/lib/vehicles/registration-review/run-registration-analysis");
const { replaceVehicleDocument } = await import("@/lib/vehicles/documents/replace-vehicle-document");
const { REGISTRATION_PARSER_VERSION } = await import("./constants");

let admin: PrismaClient, db: PrismaClient;
let plateSeq = 500;

/** Synthetic Latin registration PDFs (the in-test PDF builder is Latin-only). */
const mazdaPdf = () => buildSyntheticPdf([["TEST DOCUMENT - NOT A REAL VEHICLE REGISTRATION", `Plate Number: T ${++plateSeq}`, "Vehicle description: MAZDA6 SALOON", "Model Year: 2019", "Color: White", "Number of Passengers: 5"]]);
/** Unknown manufacturer → a CURRENT but INCOMPLETE local reading (plate makes it usable). */
const unknownPdf = (plate = ++plateSeq) => buildSyntheticPdf([["TEST DOCUMENT - NOT A REAL VEHICLE REGISTRATION", `Plate Number: T ${plate}`, "Vehicle description: ACMEMOTORS SALOON 9", "Model Year: 2019", "Color: White"]]);
const AUTOMATIC: RegistrationReadResult = { ok: true, inferenceGeo: "us", candidates: { makeDescription: [{ text: "Mazda" }], model: [{ text: "6" }], manufactureYear: [{ text: "2019" }] } };

function uploadRequest(requestKey: string, body: ArrayBuffer) {
  const form = new FormData();
  form.set("locale", "en");
  form.set("requestKey", requestKey);
  form.set("file", new File([body], "reg.pdf", { type: "application/pdf" }));
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", { method: "POST", body: form, headers: { accept: "application/json" } });
}
async function upload(provider: string, body: ArrayBuffer, key = randomUUID()) {
  const res = await as(provider, () => POST(uploadRequest(key, body)));
  const json = (await res.json()) as { ok: boolean; redirectTo?: string };
  return { key, id: json.redirectTo!.split("/").pop()!.split("?")[0]! };
}
function holdNextCall() {
  let entered!: () => void, release!: () => void;
  const inFlight = new Promise<void>((r) => (entered = r));
  const wait = new Promise<void>((r) => (release = r));
  state.ocr.gate = { entered, wait };
  return { inFlight, release };
}
const grantForCompletion = (provider: string, id: string) => as(provider, () => decideRegistrationOcrConsent(id, "GRANTED", { ownerAuthorizationConfirmed: true, locale: "en", then: "COMPLETION" }));

const q = <T>(sql: string, ...params: unknown[]) => db.$queryRawUnsafe(sql, ...params) as Promise<T[]>;
const n = async (sql: string, ...params: unknown[]) => Number((await q<{ n: number }>(sql, ...params))[0]!.n);
type Ext = { id: string; status: string; source: string; parserVersion: string; ocrCallCount: number | null; warnings: string[] | null; fields: Record<string, { normalizedValue: unknown; warnings: string[] }>; processingToken: string | null; documentSha256: string; version: number };
const ext = async (assetId: string) =>
  (await q<Ext>(`SELECT id::text, status::text, source, "parserVersion", "ocrCallCount", warnings, fields, "processingToken"::text, "documentSha256", version FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, assetId))[0] ?? null;
const audits = (assetId: string, action: string) => n(`SELECT count(*)::int n FROM "audit_logs" WHERE action=$2 AND "entityId"=$1::uuid`, assetId, action);
/** Degrade a stored row to the exact STAGING shape: older version, make + model unresolved. */
async function makeStale(assetId: string) {
  await db.$executeRawUnsafe(
    `UPDATE "vehicle_registration_extractions" SET "parserVersion"='1.1.0',
       fields = jsonb_set(jsonb_set(fields, '{makeDescription}', '{"rawValue":null,"normalizedValue":null,"confidence":"LOW","warnings":["MISSING"]}'::jsonb),
                          '{model}', '{"rawValue":null,"normalizedValue":null,"confidence":"LOW","warnings":["MISSING"]}'::jsonb)
     WHERE "assetId"=$1::uuid`,
    assetId,
  );
}
const UNTOUCHED = ["bookings", "vehicle_reservations", "prices", "services"];
const counts = async () => Object.fromEntries(await Promise.all(UNTOUCHED.map(async (t) => [t, (await n(`SELECT to_regclass($1) IS NOT NULL AS n`, t)) ? await n(`SELECT count(*)::int n FROM "${t}"`) : -1])));
let before: Record<string, number>;

beforeAll(async () => {
  if (!RUN) return;
  admin = new PrismaClient({ datasources: { db: { url: urls().admin } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: PROJECT, stdio: "ignore", env: { ...process.env, DATABASE_URL: throwawayUrl, DIRECT_URL: throwawayUrl } });
  db = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    for (const id of [PROV_A, PROV_B]) {
      await tx.$executeRawUnsafe(`INSERT INTO "users" ("id","createdAt","updatedAt") VALUES ($1::uuid,now(),now())`, id);
      await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$1::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, id);
    }
  });
  before = await counts();
}, 240_000);

afterAll(async () => {
  if (!RUN) return;
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.$disconnect();
});

beforeEach(() => {
  state.failCompletionAuditOnce = false;
  state.ocr.policyVersion = NOTICE;
  state.ocr.answer = AUTOMATIC;
  state.ocr.calls.length = 0;
  state.ocr.gate = null;
});

describe.skipIf(!RUN)("registration recovery (stale re-read + optional PDF completion) — real PostgreSQL", () => {
  it("a native-text PDF is read LOCALLY under the current version: 'MAZDA6 SALOON' → make Mazda, model 6 (LOW, heuristic); no external call", async () => {
    const { id } = await upload(PROV_A, mazdaPdf());
    const row = (await ext(id))!;
    expect(row).toMatchObject({ source: "NATIVE_PDF_TEXT", parserVersion: REGISTRATION_PARSER_VERSION });
    expect(row.fields.makeDescription!.normalizedValue).toBe("Mazda");
    expect(row.fields.model!.normalizedValue).toBe("6");
    expect(row.fields.makeDescription!.warnings).toContain("HEURISTIC_SPLIT");
    expect(state.ocr.calls).toHaveLength(0);
    const review = (await as(PROV_A, () => getRegistrationReview(id)))!;
    expect(review.recovery.state).toBeNull();
    expect(review.vehicleTypeSuggestion).toBe("SEDAN");
  });

  it("STALE-VERSION INVALIDATION: a row degraded to the staging shape under the old version is shown STALE (GET writes nothing); 'Read document again' re-reads it LOCALLY and fills make/model", async () => {
    const { id } = await upload(PROV_A, mazdaPdf());
    await makeStale(id);
    const v0 = (await ext(id))!.version;
    const review = (await as(PROV_A, () => getRegistrationReview(id)))!;
    expect(review.recovery.state).toBe("STALE");
    expect(review.fields.find((f) => f.key === "make")!.extractedValue).toBeNull();
    expect(review.vehicleTypeSuggestion).toBe("SEDAN"); // the staging shape: hint present, identity missing
    expect((await ext(id))!.version).toBe(v0); // rendering wrote nothing
    expect(await as(PROV_A, () => rereadRegistrationDocument(id))).toEqual({ ok: true, changed: true });
    const row = (await ext(id))!;
    expect(row.parserVersion).toBe(REGISTRATION_PARSER_VERSION);
    expect(row.fields.makeDescription!.normalizedValue).toBe("Mazda");
    expect(row.fields.model!.normalizedValue).toBe("6");
    expect(state.ocr.calls).toHaveLength(0);
    expect(await audits(id, "vehicle.registration_reread_requested")).toBe(1);
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.recovery.state).toBeNull();
  });

  it("CURRENT-VERSION REUSE: a second re-read / an upload replay of a current reading does no work (no write, no audit, no call)", async () => {
    const { id, key } = await upload(PROV_A, mazdaPdf());
    const r0 = (await ext(id))!;
    const extractedAudits = await audits(id, "vehicle.registration_extracted");
    expect(await as(PROV_A, () => rereadRegistrationDocument(id))).toEqual({ ok: true, changed: false });
    await upload(PROV_A, new ArrayBuffer(0) as never, key).catch(() => undefined); // a replayed request key answers the same setup
    const r1 = (await ext(id))!;
    expect(r1.version).toBe(r0.version);
    expect(await audits(id, "vehicle.registration_extracted")).toBe(extractedAudits);
    expect(await audits(id, "vehicle.registration_reread_requested")).toBe(0);
  });

  it("LOCAL RE-READ CONCURRENCY: two simultaneous re-reads converge on ONE current row (one extraction write); the provider's DRAFT is re-bound and keeps their entries", async () => {
    const { id } = await upload(PROV_A, mazdaPdf());
    expect(await as(PROV_A, () => writeRegistrationConfirmation("DRAFT", id, { model: "Testtrim", bookablePassengerCapacity: "4" }))).toMatchObject({ ok: true });
    await makeStale(id);
    await db.$executeRawUnsafe(`UPDATE "vehicle_registration_confirmations" SET "boundParserVersion"='1.1.0' WHERE "assetId"=$1::uuid`, id);
    const writesBefore = await audits(id, "vehicle.registration_extracted");
    const [a, b] = await Promise.all([as(PROV_A, () => rereadRegistrationDocument(id)), as(PROV_A, () => rereadRegistrationDocument(id))]);
    expect(a.ok && b.ok).toBe(true);
    expect(await audits(id, "vehicle.registration_extracted")).toBe(writesBefore + 1);
    expect(await n(`SELECT count(*)::int n FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id)).toBe(1);
    const conf = (await q<{ boundParserVersion: string; model: string | null; status: string }>(`SELECT "boundParserVersion", model, status::text FROM "vehicle_registration_confirmations" WHERE "assetId"=$1::uuid AND status <> 'SUPERSEDED'`, id))[0]!;
    expect(conf).toMatchObject({ boundParserVersion: REGISTRATION_PARSER_VERSION, model: "Testtrim", status: "DRAFT" });
    const view = (await as(PROV_A, () => getRegistrationReview(id)))!;
    expect(view.fields.find((f) => f.key === "model")!).toMatchObject({ confirmedValue: "Testtrim", source: "PROVIDER" });
  });

  it("ONE EFFECTIVE COMPLETION: no call before consent; consent → ONE call while a concurrent attempt is told IN_PROGRESS; the merge fills make/model as reviewable suggestions", async () => {
    const { id } = await upload(PROV_A, unknownPdf());
    const view = (await as(PROV_A, () => getRegistrationReview(id)))!;
    expect(view.recovery).toMatchObject({ state: "INCOMPLETE", completionAvailable: true });
    // No consent yet: nothing is sent.
    expect(await as(PROV_A, () => completeRegistrationReading(id))).toEqual({ ok: false, code: "OCR_CONSENT_REQUIRED" });
    expect(state.ocr.calls).toHaveLength(0);
    const hold = holdNextCall();
    const granting = grantForCompletion(PROV_A, id);
    await hold.inFlight;
    expect(await as(PROV_A, () => completeRegistrationReading(id))).toEqual({ ok: true, outcome: "IN_PROGRESS" });
    expect((await as(PROV_A, () => getRegistrationReview(id)))!.recovery.completionInProgress).toBe(true);
    hold.release();
    expect(await granting).toMatchObject({ ok: true, decision: "GRANTED", completion: { ok: true, outcome: "COMPLETED" } });
    expect(state.ocr.calls).toHaveLength(1);
    expect(state.ocr.calls[0]!.pages).toEqual([{ role: "FRONT", mimeType: "application/pdf" }]);
    const row = (await ext(id))!;
    expect(row.fields.makeDescription!.normalizedValue).toBe("Mazda");
    expect(row.fields.makeDescription!.warnings).toContain("FROM_AUTOMATIC_COMPLETION");
    expect(row).toMatchObject({ source: "NATIVE_PDF_TEXT", status: "NEEDS_REVIEW", ocrCallCount: 1, processingToken: null });
    expect(row.warnings).toContain("AUTOMATIC_COMPLETION_APPLIED");
    // Replay: no second call.
    expect(await as(PROV_A, () => completeRegistrationReading(id))).toEqual({ ok: true, outcome: "ALREADY_COMPLETED" });
    expect(state.ocr.calls).toHaveLength(1);
    expect(await audits(id, "vehicle.registration_completion")).toBe(1);
  });

  it("A CONSENT FOR THE OLD NOTICE VERSION is not accepted after the version changes", async () => {
    const { id } = await upload(PROV_A, unknownPdf());
    state.ocr.policyVersion = "2026-10-07-v1";
    await as(PROV_A, () => decideRegistrationOcrConsent(id, "GRANTED", { ownerAuthorizationConfirmed: true, locale: "en" }));
    state.ocr.policyVersion = NOTICE;
    expect(await as(PROV_A, () => completeRegistrationReading(id))).toEqual({ ok: false, code: "OCR_CONSENT_REQUIRED" });
    expect(state.ocr.calls).toHaveLength(0);
  });

  it("AUDIT ROLLBACK: a failing completion audit leaves NOTHING marked complete — the local reading is unchanged and the lease is released", async () => {
    const { id } = await upload(PROV_A, unknownPdf());
    const before = (await ext(id))!;
    state.failCompletionAuditOnce = true;
    const res = await grantForCompletion(PROV_A, id);
    expect(res).toMatchObject({ ok: true, completion: { ok: false, code: "UNKNOWN_ERROR" } });
    const row = (await ext(id))!;
    expect(row.fields).toEqual(before.fields);
    expect(row.warnings ?? []).not.toContain("AUTOMATIC_COMPLETION_APPLIED");
    expect(row.processingToken).toBeNull();
    expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE action='vehicle.registration_completion' AND "entityId"=$1::uuid AND "newValue"->>'outcome'='COMPLETED'`, id)).toBe(0);
  });

  it("CANCELLATION RACE: the setup is cancelled while the request is in flight → the late answer is discarded (no row, no completion audit)", async () => {
    const { id, key } = await upload(PROV_A, unknownPdf());
    const hold = holdNextCall();
    const granting = grantForCompletion(PROV_A, id);
    await hold.inFlight;
    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true });
    hold.release();
    const res = await granting;
    expect(res).toMatchObject({ ok: true, completion: { ok: false } });
    expect(await ext(id)).toBeNull();
    expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE action='vehicle.registration_completion' AND "entityId"=$1::uuid AND "newValue"->>'outcome'='COMPLETED'`, id)).toBe(0);
  });

  it("DOCUMENT REPLACEMENT (both orders): the replace flow re-reads the new bytes; a late answer for the OLD file never lands on the NEW set", async () => {
    for (const order of ["REANALYSE_FIRST", "ANSWER_FIRST"] as const) {
      const { id } = await upload(PROV_A, unknownPdf());
      const docId = (await q<{ id: string }>(`SELECT id::text FROM "asset_documents" WHERE "assetId"=$1::uuid AND type='VEHICLE_REGISTRATION'`, id))[0]!.id;
      const oldHash = (await ext(id))!.documentSha256;
      const hold = holdNextCall();
      const granting = grantForCompletion(PROV_A, id);
      await hold.inFlight;
      expect(await as(PROV_A, () => replaceVehicleDocument(id, docId, { originalFilename: "reg2.pdf", declaredMimeType: "application/pdf", bytes: unknownPdf() }))).toEqual({ ok: true });
      // The replace route re-runs the analysis of the new bytes (as the upload/replace handler does).
      if (order === "REANALYSE_FIRST") {
        await as(PROV_A, () => runRegistrationAnalysis(id));
        hold.release();
        expect(await granting).toMatchObject({ completion: { ok: false } }); // discarded: the lease was cleared
      } else {
        hold.release();
        await granting; // lands on the OLD set's row (bound to the old hash) …
        await as(PROV_A, () => runRegistrationAnalysis(id)); // … and the re-analysis replaces it with the new bytes' reading
      }
      const row = (await ext(id))!;
      expect(row.documentSha256).not.toBe(oldHash);
      expect(row.warnings ?? []).not.toContain("AUTOMATIC_COMPLETION_APPLIED");
      expect(row.processingToken).toBeNull();
      expect(row.fields.makeDescription!.normalizedValue).toBeNull(); // the new file's own (incomplete) local reading
    }
  });

  it("PROVIDER ISOLATION + NO CROSS-PROVIDER CHECKSUM REUSE: identical bytes of another provider need their own consent and their own call; the same provider's second upload REUSES its result", async () => {
    const bytes = unknownPdf(9001);
    const a1 = await upload(PROV_A, bytes);
    expect(await grantForCompletion(PROV_A, a1.id)).toMatchObject({ completion: { ok: true, outcome: "COMPLETED" } });
    expect(state.ocr.calls).toHaveLength(1);
    // Same provider, same bytes, another setup → reused (with its own consent), no new call.
    const a2 = await upload(PROV_A, bytes);
    expect(await grantForCompletion(PROV_A, a2.id)).toMatchObject({ completion: { ok: true, outcome: "REUSED" } });
    expect(state.ocr.calls).toHaveLength(1);
    // Another provider, identical bytes → never reused; without consent nothing; with consent its own call.
    const b1 = await upload(PROV_B, bytes);
    expect(await as(PROV_B, () => completeRegistrationReading(b1.id))).toEqual({ ok: false, code: "OCR_CONSENT_REQUIRED" });
    expect(await grantForCompletion(PROV_B, b1.id)).toMatchObject({ completion: { ok: true, outcome: "COMPLETED" } });
    expect(state.ocr.calls).toHaveLength(2);
    // A cannot act on B's vehicle.
    expect(await as(PROV_A, () => completeRegistrationReading(b1.id))).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(await as(PROV_A, () => rereadRegistrationDocument(b1.id))).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
  });

  it("no Booking, VehicleReservation, Price or Service row was created or changed; no public vehicle fact was written by any recovery path", async () => {
    expect(await counts()).toEqual(before);
    expect(await n(`SELECT count(*)::int n FROM "vehicles" WHERE make IS NOT NULL OR model IS NOT NULL`)).toBe(0);
  });
});
