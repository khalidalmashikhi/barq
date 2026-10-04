import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { buildSyntheticPdf, isoBmffHeader, SYNTHETIC_REGISTRATION_LINES } from "@/lib/vehicles/documents/synthetic-test-documents";

// Phase 3C Slice 3B (idempotency-lifecycle correction) — REAL-PostgreSQL proof of the DURABLE
// onboarding request: the idempotency record that is claimed before any work and that OUTLIVES the
// vehicle setup it produced. Requests go through the ACTUAL route handler / domain functions → the
// real unique index, real transactions, the real audit table, the real cleanup outbox, the real
// image/PDF preparation and the real native-PDF extraction. Only the session (which provider is
// signed in) and the storage bucket (an in-memory fake — no network, no real document) are
// substituted. Everything uploaded is synthetic.
//
// Gated behind REGISTRATION_DBPROOF=1 so the default suite never touches a database:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/onboarding/onboarding-request.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";

const PROJECT = process.cwd();
const dbName = "barq_onboard_dbproof_" + randomUUID().slice(0, 8);
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

// ── the signed-in provider (per async call chain, so two providers can act concurrently) ──────────
const { session, state } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage: ALS } = require("node:async_hooks") as typeof import("node:async_hooks");
  return {
    session: new ALS<string>(),
    state: {
      failAuditFor: null as string | null, // provider id whose next onboarding audit throws
      storage: new Map<string, ArrayBuffer>(),
      uploaded: [] as string[],
      removed: [] as string[],
      removeMode: "ok" as "ok" | "transient",
      uploadMode: "ok" as "ok" | "fail",
      uploadDelayMs: 0,
      // A gate that HOLDS the next upload(s) mid-flight until the test releases it.
      gate: null as null | { entered: () => void; wait: Promise<void> },
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
// REAL audit writer (rows land in audit_logs) with one injectable failure.
vi.mock("@/lib/audit/record-audit-event", async (original) => {
  const real = await original<typeof import("@/lib/audit/record-audit-event")>();
  return {
    recordAuditEvent: (params: Parameters<typeof real.recordAuditEvent>[0], tx: Parameters<typeof real.recordAuditEvent>[1]) => {
      if (params.action === "vehicle.onboarding_draft_created" && state.failAuditFor === params.actorId) {
        state.failAuditFor = null;
        return Promise.reject(new Error("audit boom"));
      }
      return real.recordAuditEvent(params, tx);
    },
  };
});
// FAKE private bucket: records every write/delete, can fail, delay or HOLD an upload mid-flight.
vi.mock("@/lib/storage/storage", () => {
  class StorageNotConfiguredError extends Error {}
  return {
    StorageNotConfiguredError,
    isDocumentStorageConfigured: () => true,
    uploadPrivateObject: async (p: { objectKey: string; body: ArrayBuffer }) => {
      if (state.uploadMode === "fail") throw new Error(`upstream 503 while writing ${p.objectKey}`);
      state.uploaded.push(p.objectKey);
      state.storage.set(p.objectKey, p.body);
      const gate = state.gate;
      if (gate) {
        state.gate = null; // holds exactly ONE upload
        gate.entered();
        await gate.wait;
      }
      if (state.uploadDelayMs > 0) await new Promise((r) => setTimeout(r, state.uploadDelayMs));
    },
    downloadPrivateObject: async (objectKey: string) => {
      const body = state.storage.get(objectKey);
      if (!body) throw new Error("Object not found");
      return body.slice(0); // a real bucket returns fresh bytes on every download
    },
    removePrivateObject: async (objectKey: string) => {
      if (state.removeMode === "transient") throw new Error("ECONNRESET temporary 503");
      state.removed.push(objectKey);
      state.storage.delete(objectKey);
    },
  };
});

const { POST } = await import("@/app/api/provider/vehicles/onboarding/upload/route");
const { startVehicleOnboarding } = await import("./start-vehicle-onboarding");
const { cancelVehicleOnboardingRequest } = await import("./cancel-onboarding-request");
const { purgeExpiredOnboardingRequests } = await import("./onboarding-request");
const { deleteDraftVehicle } = await import("./delete-draft-vehicle");
const { runPrivateObjectCleanup } = await import("@/lib/storage/cleanup/private-object-cleanup");

let admin: PrismaClient, db: PrismaClient;

const ab = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const PDF = () => buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]);
const OTHER_PDF = () => buildSyntheticPdf([["Vehicle Make: Other", "Plate Number: X 1"]]);
const newKey = () => randomUUID();
const start = (key: string, bytes: ArrayBuffer = PDF(), claim?: { waitMs?: number; pollMs?: number }) =>
  startVehicleOnboarding({ requestKey: key, originalFilename: "synthetic-registration.pdf", declaredMimeType: "application/pdf", bytes }, claim ? { claim } : undefined);

function uploadRequest(requestKey: string, body: ArrayBuffer, type = "application/pdf", name = "synthetic-registration.pdf") {
  const form = new FormData();
  form.set("locale", "en");
  form.set("requestKey", requestKey);
  form.set("file", new File([body], name, { type }));
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", { method: "POST", body: form, headers: { accept: "application/json" } });
}
type Json = { ok: boolean; redirectTo?: string; replayed?: boolean; error?: string };
const vehicleIdOf = (json: Json) => json.redirectTo!.split("/").pop()!.split("?")[0]!;

// Every answer any caller received in this suite — checked at the end for raw database errors.
const answers: unknown[] = [];
const keep = <T>(value: T): T => (answers.push(value), value);
async function post(provider: string, req: Request) {
  const res = await as(provider, () => POST(req));
  const json = (await res.json()) as Json;
  keep({ status: res.status, json });
  return { status: res.status, json };
}

function holdNextUpload() {
  let entered!: () => void, release!: () => void;
  const inFlight = new Promise<void>((r) => (entered = r));
  const wait = new Promise<void>((r) => (release = r));
  state.gate = { entered, wait };
  return { inFlight, release };
}

const q = <T>(sql: string, ...params: unknown[]) => db.$queryRawUnsafe(sql, ...params) as Promise<T[]>;
const n = async (sql: string, ...params: unknown[]) => Number((await q<{ n: number }>(sql, ...params))[0]!.n);
type RequestRow = { id: string; status: string; assetId: string | null; leaseToken: string | null; leaseExpiresAt: Date | null; completedAt: Date | null; cancelledAt: Date | null; expiresAt: Date };
const requestsFor = (prov: string, key: string) =>
  q<RequestRow>(`SELECT id, status::text, "assetId"::text, "leaseToken"::text, "leaseExpiresAt", "completedAt", "cancelledAt", "expiresAt" FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, prov, key);
const assetExists = async (id: string) => (await n(`SELECT count(*)::int n FROM "assets" WHERE id=$1::uuid`, id)) === 1;
const docsFor = (assetId: string) => q<{ id: string; objectKey: string; mimeType: string; sizeBytes: number }>(`SELECT id,"objectKey","mimeType","sizeBytes" FROM "asset_documents" WHERE "assetId"=$1::uuid`, assetId);
const createdAudits = (assetId: string) => n(`SELECT count(*)::int n FROM "audit_logs" WHERE action='vehicle.onboarding_draft_created' AND "entityId"=$1::uuid`, assetId);
const pendingCleanup = () => n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE status <> 'COMPLETED'`);
const tableCount = (t: string) => n(`SELECT count(*)::int n FROM "${t}"`);
const assetCount = () => tableCount("assets");
/** No object this suite uploaded is left in the bucket unless a document row references it. */
async function noOrphanObjects() {
  const referenced = new Set((await q<{ objectKey: string }>(`SELECT "objectKey" FROM "asset_documents"`)).map((r) => r.objectKey));
  expect([...state.storage.keys()].filter((k) => !referenced.has(k))).toEqual([]);
}

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
  state.failAuditFor = null;
  state.uploaded.length = 0;
  state.removed.length = 0;
  state.removeMode = "ok";
  state.uploadMode = "ok";
  state.uploadDelayMs = 0;
  state.gate = null;
});

describe.skipIf(!RUN)("durable onboarding request — real PostgreSQL", () => {
  it("schema: the request table, its unique arbiter and its tombstone-preserving foreign key exist; assets carry NO idempotency column", async () => {
    const idx = await q<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='vehicle_onboarding_requests' ORDER BY 1`);
    const byName = Object.fromEntries(idx.map((i) => [i.indexname, i.indexdef]));
    expect(byName["vehicle_onboarding_requests_providerId_idempotencyKey_key"]).toMatch(/CREATE UNIQUE INDEX/);
    expect(byName["vehicle_onboarding_requests_assetId_key"]).toMatch(/CREATE UNIQUE INDEX/);
    expect(byName["vehicle_onboarding_requests_expiresAt_idx"]).toBeDefined();
    const fks = await q<{ conname: string; def: string }>(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='vehicle_onboarding_requests'::regclass AND contype='f' ORDER BY 1`);
    expect(fks.find((f) => f.conname.endsWith("assetId_fkey"))!.def).toMatch(/ON DELETE SET NULL/);
    expect(fks.find((f) => f.conname.endsWith("providerId_fkey"))!.def).toMatch(/ON DELETE RESTRICT/);
    expect(await n(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='assets' AND column_name='onboardingRequestKey'`)).toBe(0);
  });

  it("(1) TWO SIMULTANEOUS same-key upload requests → ONE durable request, ONE shell, ONE document, ONE audit, ONE upload", async () => {
    for (let round = 0; round < 8; round++) {
      state.uploaded.length = 0; state.removed.length = 0;
      state.uploadDelayMs = round % 2 === 0 ? 150 : 0; // even rounds: the first is certainly still in flight when the second arrives
      const key = newKey();
      const [r1, r2] = await Promise.all([post(PROV_A, uploadRequest(key, PDF())), post(PROV_A, uploadRequest(key, PDF()))]);
      state.uploadDelayMs = 0;

      // Both callers get the SAME safe success — never a raw database error.
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(vehicleIdOf(r1.json)).toBe(vehicleIdOf(r2.json));
      expect([r1.json.replayed, r2.json.replayed].sort()).toEqual([false, true]); // exactly one created it
      for (const r of [r1, r2]) expect(JSON.stringify(r.json)).not.toContain(key);

      const requests = await requestsFor(PROV_A, key);
      expect(requests).toHaveLength(1);
      const id = vehicleIdOf(r1.json);
      expect(requests[0]).toMatchObject({ status: "COMPLETED", assetId: id, leaseToken: null, leaseExpiresAt: null, cancelledAt: null });
      expect(requests[0]!.completedAt).not.toBeNull();

      expect(await assetExists(id)).toBe(true);
      expect(await n(`SELECT count(*)::int n FROM "vehicles" WHERE "assetId"=$1::uuid`, id)).toBe(1);
      const docs = await docsFor(id);
      expect(docs).toHaveLength(1);
      expect(await createdAudits(id)).toBe(1);
      // The stored object is the full document (never an emptied buffer) and was read exactly once.
      expect(docs[0]!.sizeBytes).toBe(PDF().byteLength);
      expect(state.storage.get(docs[0]!.objectKey)!.byteLength).toBe(docs[0]!.sizeBytes);
      const extractions = await q<{ status: string }>(`SELECT status::text FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id);
      expect(extractions).toHaveLength(1);
      expect(extractions[0]!.status).not.toBe("FAILED");

      // The waiting request never uploaded anything: ONE object written, none to clean up.
      expect(state.uploaded).toEqual([docs[0]!.objectKey]);
      expect(state.removed).toEqual([]);
      expect(await pendingCleanup()).toBe(0);
      expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey"=$1`, docs[0]!.objectKey)).toBe(0); // intent released
    }
    await noOrphanObjects();
  }, 240_000);

  it("(2) a FIVE-WAY same-key race → one request, one shell, one audit, one upload; every caller gets the same result", async () => {
    for (let round = 0; round < 4; round++) {
      state.uploaded.length = 0;
      const key = newKey();
      const results = keep(await as(PROV_A, () => Promise.all(Array.from({ length: 5 }, () => start(key)))));
      expect(results.every((r) => r.ok)).toBe(true);
      expect(new Set(results.map((r) => (r.ok ? r.vehicleId : "x"))).size).toBe(1);
      expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
      const requests = await requestsFor(PROV_A, key);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.status).toBe("COMPLETED");
      expect(await docsFor(requests[0]!.assetId!)).toHaveLength(1);
      expect(await createdAudits(requests[0]!.assetId!)).toBe(1);
      expect(state.uploaded).toHaveLength(1);
      expect(await pendingCleanup()).toBe(0);
    }
  }, 240_000);

  it("(3) LOST RESPONSE then replay → the same setup: no new upload, no second audit, and a different replayed file does NOT replace the document", async () => {
    const key = newKey();
    const lost = keep(await as(PROV_A, () => start(key))); // the browser never saw this answer
    if (!lost.ok) throw new Error("start failed");
    const id = lost.vehicleId;
    const before = (await docsFor(id))[0]!;
    const assetsBefore = await assetCount();

    state.uploaded.length = 0;
    // The reloaded page re-sends the SAME key (it lives in the tab's session storage).
    const otherFile = ab(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#336699" } }).jpeg().toBuffer());
    const replay = await post(PROV_A, uploadRequest(key, otherFile, "image/jpeg", "different.jpg"));
    expect(replay).toEqual({ status: 200, json: { ok: true, redirectTo: `/provider/vehicles/new/${id}?resumed=1`, replayed: true } });
    for (let i = 0; i < 3; i++) expect(keep(await as(PROV_A, () => start(key, OTHER_PDF())))).toEqual({ ok: true, vehicleId: id, replayed: true });

    expect(state.uploaded).toEqual([]); // the replayed file never reached storage
    expect((await docsFor(id))[0]).toEqual(before); // same document, same object, same type
    expect(await createdAudits(id)).toBe(1);
    expect(await assetCount()).toBe(assetsBefore);
    expect(await requestsFor(PROV_A, key)).toHaveLength(1);
  });

  it("(4) REPLAY AFTER CANCELLATION → terminal 'cancelled': the tombstone outlives the asset; nothing is recreated or resurrected", async () => {
    const key = newKey();
    const first = keep(await as(PROV_A, () => start(key)));
    if (!first.ok) throw new Error("start failed");
    const object = (await docsFor(first.vehicleId))[0]!.objectKey;
    const requestId = (await requestsFor(PROV_A, key))[0]!.id;

    expect(await as(PROV_A, () => deleteDraftVehicle(first.vehicleId))).toEqual({ ok: true });
    expect(await assetExists(first.vehicleId)).toBe(false);
    expect(state.storage.has(object)).toBe(false);

    // The request row SURVIVED the asset: same id, CANCELLED, link cleared by the foreign key.
    const tomb = await requestsFor(PROV_A, key);
    expect(tomb).toHaveLength(1);
    expect(tomb[0]).toMatchObject({ id: requestId, status: "CANCELLED", assetId: null, leaseToken: null });
    expect(tomb[0]!.cancelledAt).not.toBeNull();
    expect(tomb[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000); // retained

    // A delayed / replayed upload carrying that key creates NOTHING — domain and route agree.
    const assetsBefore = await assetCount();
    state.uploaded.length = 0;
    for (let i = 0; i < 3; i++) expect(keep(await as(PROV_A, () => start(key)))).toEqual({ ok: false, error: "ONBOARDING_CANCELLED" });
    expect(await post(PROV_A, uploadRequest(key, PDF()))).toEqual({ status: 409, json: { ok: false, error: "ONBOARDING_CANCELLED" } });
    expect(state.uploaded).toEqual([]);
    expect(await assetCount()).toBe(assetsBefore);
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "CANCELLED", assetId: null });
    await noOrphanObjects();
  });

  it("(4b) the tombstone can be written BEFORE the upload ever arrives: a cancelled key refuses a late first request", async () => {
    const key = newKey();
    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true });
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "CANCELLED", assetId: null });
    const assetsBefore = await assetCount();
    expect(keep(await as(PROV_A, () => start(key)))).toEqual({ ok: false, error: "ONBOARDING_CANCELLED" }); // the delayed request
    expect(state.uploaded).toEqual([]);
    expect(await assetCount()).toBe(assetsBefore);
    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true }); // idempotent
    expect(await requestsFor(PROV_A, key)).toHaveLength(1);
  });

  it("(5) a DELAYED duplicate upload RACING a cancellation converges: one CANCELLED request, no shell, no new upload, no orphan", async () => {
    for (let round = 0; round < 8; round++) {
      const key = newKey();
      const created = keep(await as(PROV_A, () => start(key)));
      if (!created.ok) throw new Error("start failed");
      const assetsBefore = await assetCount();
      state.uploaded.length = 0;

      const [cancel, late] = await as(PROV_A, () => Promise.all([deleteDraftVehicle(created.vehicleId), start(key, OTHER_PDF())]));
      keep(late);
      expect(cancel).toEqual({ ok: true });
      // The late request either saw the setup just before it was cancelled, or saw the tombstone.
      // Either way it created nothing.
      expect([JSON.stringify({ ok: true, vehicleId: created.vehicleId, replayed: true }), JSON.stringify({ ok: false, error: "ONBOARDING_CANCELLED" })]).toContain(JSON.stringify(late));
      expect(state.uploaded).toEqual([]);
      expect(await assetExists(created.vehicleId)).toBe(false);
      expect(await assetCount()).toBe(assetsBefore - 1);
      const rows = await requestsFor(PROV_A, key);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "CANCELLED", assetId: null });
      // And from now on the key is terminal.
      expect(keep(await as(PROV_A, () => start(key)))).toEqual({ ok: false, error: "ONBOARDING_CANCELLED" });
      expect(await pendingCleanup()).toBe(0);
    }
    await noOrphanObjects();
  }, 240_000);

  it("(6a) cancellation WINS against an upload still in flight: the attempt commits nothing and its stored object is removed", async () => {
    const key = newKey();
    const hold = holdNextUpload();
    const assetsBefore = await assetCount();
    const inFlight = as(PROV_A, () => start(key));
    await hold.inFlight; // the object is written; the transaction has not started
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "PENDING", assetId: null });

    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true });
    hold.release();
    expect(keep(await inFlight)).toEqual({ ok: false, error: "ONBOARDING_CANCELLED" });

    expect(await assetCount()).toBe(assetsBefore); // no shell, no half-created graph
    expect(state.uploaded).toHaveLength(1);
    expect(state.removed).toEqual(state.uploaded); // its object was removed
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "objectKey"=$1`, state.uploaded[0]!)).toBe(0);
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "CANCELLED", assetId: null, leaseToken: null });
    expect(await pendingCleanup()).toBe(0);
    await noOrphanObjects();
  });

  it("(6b) cancellation RACING request completion (natural timing): always ONE terminal state, never a surviving shell or object", async () => {
    for (let round = 0; round < 10; round++) {
      state.uploaded.length = 0; state.removed.length = 0;
      state.uploadDelayMs = (round % 3) * 20; // vary which side tends to win
      const key = newKey();
      const assetsBefore = await assetCount();
      const [started, cancelled] = await as(PROV_A, () => Promise.all([start(key), cancelVehicleOnboardingRequest(key)]));
      keep(started); keep(cancelled);
      state.uploadDelayMs = 0;

      expect(cancelled).toEqual({ ok: true }); // if creation won, cancellation cancelled that one setup
      if (!started.ok) expect(started.error).toBe("ONBOARDING_CANCELLED");
      const rows = await requestsFor(PROV_A, key);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "CANCELLED", assetId: null, leaseToken: null });
      expect(await assetCount()).toBe(assetsBefore);
      for (const k of state.uploaded) expect(state.storage.has(k)).toBe(false);
      expect(await pendingCleanup()).toBe(0);
    }
    await noOrphanObjects();
  }, 240_000);

  it("(6c) a setup that has since been CONFIRMED cannot be cancelled through its old request key, and a stale key cannot overwrite it", async () => {
    const key = newKey();
    const started = keep(await as(PROV_A, () => start(key)));
    if (!started.ok) throw new Error("start failed");
    const id = started.vehicleId;
    // The vehicle has since been confirmed and submitted (values written by the reviewed finalize).
    await db.$executeRawUnsafe(`UPDATE "vehicles" SET make='Toyota', model='Testcruiser', "registrationNumber"=$2 WHERE "assetId"=$1::uuid`, id, "T-" + id.slice(0, 8));
    await db.$executeRawUnsafe(`UPDATE "assets" SET "verificationStatus"='SUBMITTED'::"AssetVerificationStatus" WHERE id=$1::uuid`, id);
    const docBefore = (await docsFor(id))[0]!;

    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: false, code: "NOT_CANCELLABLE" });
    state.uploaded.length = 0;
    expect(keep(await as(PROV_A, () => start(key, OTHER_PDF())))).toEqual({ ok: true, vehicleId: id, replayed: true });
    expect(state.uploaded).toEqual([]);
    expect((await q<{ make: string; model: string }>(`SELECT make, model FROM "vehicles" WHERE "assetId"=$1::uuid`, id))[0]).toEqual({ make: "Toyota", model: "Testcruiser" });
    expect((await docsFor(id))[0]).toEqual(docBefore);
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "COMPLETED", assetId: id });
  });

  it("(7) the SAME key under two providers stays isolated — sequentially, concurrently, and for cancellation", async () => {
    const key = newKey();
    const a = keep(await as(PROV_A, () => start(key)));
    const b = keep(await as(PROV_B, () => start(key)));
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(b).toMatchObject({ ok: true, replayed: false }); // NOT a replay of A's setup
    if (!a.ok || !b.ok) return;
    expect(b.vehicleId).not.toBe(a.vehicleId);
    expect((await requestsFor(PROV_A, key))[0]!.assetId).toBe(a.vehicleId);
    expect((await requestsFor(PROV_B, key))[0]!.assetId).toBe(b.vehicleId);
    expect(keep(await as(PROV_B, () => start(key)))).toEqual({ ok: true, vehicleId: b.vehicleId, replayed: true }); // B replays B's own
    // B can reach A's setup neither by id nor by key.
    expect(await as(PROV_B, () => deleteDraftVehicle(a.vehicleId))).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(await as(PROV_B, () => cancelVehicleOnboardingRequest(key))).toEqual({ ok: true }); // cancels B's OWN request
    expect((await requestsFor(PROV_B, key))[0]).toMatchObject({ status: "CANCELLED", assetId: null });
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "COMPLETED", assetId: a.vehicleId }); // A untouched
    expect(await assetExists(a.vehicleId)).toBe(true);
    expect(keep(await as(PROV_A, () => start(key)))).toEqual({ ok: true, vehicleId: a.vehicleId, replayed: true });

    // Concurrent, same key, two providers → two independent setups.
    const key2 = newKey();
    const [c, d] = await Promise.all([as(PROV_A, () => start(key2)), as(PROV_B, () => start(key2))]);
    keep(c); keep(d);
    expect(c).toMatchObject({ ok: true, replayed: false });
    expect(d).toMatchObject({ ok: true, replayed: false });
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE "idempotencyKey"=$1`, key2)).toBe(2);
  });

  it("(8) DIFFERENT keys from one provider are distinct setups", async () => {
    const [k1, k2] = [newKey(), newKey()];
    const [a, b] = await as(PROV_A, () => Promise.all([start(k1), start(k2)]));
    keep(a); keep(b);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.vehicleId).not.toBe(b.vehicleId);
    expect(a.replayed || b.replayed).toBe(false);
    expect(await docsFor(a.vehicleId)).toHaveLength(1);
    expect(await docsFor(b.vehicleId)).toHaveLength(1);
    expect((await requestsFor(PROV_A, k1))[0]!.assetId).toBe(a.vehicleId);
    expect((await requestsFor(PROV_A, k2))[0]!.assetId).toBe(b.vehicleId);
  });

  it("(9) AUDIT FAILURE rolls back the graph AND the request transition: the request stays PENDING and retryable, the object is removed", async () => {
    const key = newKey();
    const assetsBefore = await assetCount();
    state.failAuditFor = PROV_A;
    const failed = await post(PROV_A, uploadRequest(key, PDF()));
    expect(failed).toEqual({ status: 500, json: { ok: false, error: "UNKNOWN_ERROR" } }); // a safe code, not a database error

    expect(await assetCount()).toBe(assetsBefore); // no shell
    const rows = await requestsFor(PROV_A, key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "PENDING", assetId: null, leaseToken: null, leaseExpiresAt: null, completedAt: null }); // NOT completed; lease given back
    expect(state.uploaded).toHaveLength(1);
    expect(state.removed).toEqual(state.uploaded);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "objectKey"=$1`, state.uploaded[0]!)).toBe(0);
    expect(await pendingCleanup()).toBe(0);

    // Same key, retried: it now succeeds on the SAME request row.
    const retry = await post(PROV_A, uploadRequest(key, PDF()));
    expect(retry.json).toMatchObject({ ok: true, replayed: false });
    const after = await requestsFor(PROV_A, key);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: rows[0]!.id, status: "COMPLETED", assetId: vehicleIdOf(retry.json) });
    expect(await createdAudits(vehicleIdOf(retry.json))).toBe(1);
  });

  it("(10) STORAGE FAILURE leaves a retryable request and nothing stranded; a stranded object is owned by the cleanup worker", async () => {
    // (a) the bucket write itself fails
    const key = newKey();
    const assetsBefore = await assetCount();
    state.uploadMode = "fail";
    expect(await post(PROV_A, uploadRequest(key, PDF()))).toEqual({ status: 503, json: { ok: false, error: "UPLOAD_FAILED" } });
    state.uploadMode = "ok";
    expect(await assetCount()).toBe(assetsBefore);
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "PENDING", assetId: null, leaseToken: null }); // retryable
    expect(await pendingCleanup()).toBe(0); // the intent for the never-written object was resolved
    expect(keep(await as(PROV_A, () => start(key)))).toMatchObject({ ok: true, replayed: false }); // same key now works

    // (b) the object WAS written, the transaction failed, and the immediate delete also failed
    const key2 = newKey();
    state.uploaded.length = 0;
    state.failAuditFor = PROV_A;
    state.removeMode = "transient";
    expect(keep(await as(PROV_A, () => start(key2)))).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    const orphan = state.uploaded[0]!;
    expect(state.storage.has(orphan)).toBe(true); // still in the bucket…
    const task = await q<{ status: string; attemptCount: number }>(`SELECT status::text,"attemptCount" FROM "private_object_cleanup_tasks" WHERE "objectKey"=$1`, orphan);
    expect(task).toEqual([{ status: "PENDING", attemptCount: 1 }]); // …but durably owned by the cleanup worker
    expect((await requestsFor(PROV_A, key2))[0]).toMatchObject({ status: "PENDING", assetId: null, leaseToken: null }); // and the request is retryable

    state.removeMode = "ok";
    await db.$executeRawUnsafe(`UPDATE "private_object_cleanup_tasks" SET "nextAttemptAt"=now() - interval '1 minute' WHERE "objectKey"=$1`, orphan);
    expect((await runPrivateObjectCleanup()).completed).toBeGreaterThanOrEqual(1);
    expect(state.storage.has(orphan)).toBe(false);
    expect(await pendingCleanup()).toBe(0);
    await noOrphanObjects();
  });

  it("(11) REDUNDANT-OBJECT race (a stalled attempt is taken over): one setup, one audit, and the stalled attempt's object is removed", async () => {
    const key = newKey();
    const hold = holdNextUpload();
    const stalled = as(PROV_A, () => start(key)); // attempt 1: object written, then it stalls
    await hold.inFlight;
    const firstObject = state.uploaded[0]!;

    // A live lease makes a duplicate wait and then report "in progress" — it does NOT upload.
    expect(keep(await as(PROV_A, () => start(key, PDF(), { waitMs: 250, pollMs: 50 })))).toEqual({ ok: false, error: "ONBOARDING_IN_PROGRESS" });
    expect(state.uploaded).toEqual([firstObject]);

    // The stalled attempt's lease runs out (it crashed or timed out) → a retry takes the request over.
    await db.$executeRawUnsafe(`UPDATE "vehicle_onboarding_requests" SET "leaseExpiresAt"=now() - interval '1 second' WHERE "providerId"=$1::uuid AND "idempotencyKey"=$2`, PROV_A, key);
    const takeover = keep(await as(PROV_A, () => start(key)));
    expect(takeover).toMatchObject({ ok: true, replayed: false });
    if (!takeover.ok) return;
    expect(state.uploaded).toHaveLength(2); // the redundant object now exists…

    hold.release(); // …and the stalled attempt wakes up, far too late
    expect(keep(await stalled)).toEqual({ ok: true, vehicleId: takeover.vehicleId, replayed: true }); // it created nothing; it reports the real setup

    const rows = await requestsFor(PROV_A, key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "COMPLETED", assetId: takeover.vehicleId });
    const docs = await docsFor(takeover.vehicleId);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.objectKey).not.toBe(firstObject);
    expect(await createdAudits(takeover.vehicleId)).toBe(1);
    expect(state.storage.has(firstObject)).toBe(false); // the redundant object is gone
    expect(state.storage.has(docs[0]!.objectKey)).toBe(true);
    expect(await n(`SELECT count(*)::int n FROM "assets" a WHERE NOT EXISTS (SELECT 1 FROM "asset_documents" d WHERE d."assetId"=a.id) AND a."providerId"=$1::uuid AND a."createdAt" > now() - interval '5 seconds'`, PROV_A)).toBe(0); // no half-created shell
    expect(await pendingCleanup()).toBe(0);
    await noOrphanObjects();
  });

  it("(12) the retention purge is BOUNDED and never removes a request that is active, in progress or still within retention", async () => {
    const seed = async (status: string, expiresIn: string, lease: string | null, withAsset = false) => {
      const id = randomUUID();
      let assetId: string | null = null;
      if (withAsset) {
        assetId = randomUUID();
        await db.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'REGISTERED'::"AssetStatus",'DRAFT'::"AssetVerificationStatus",now(),now())`, assetId, PROV_B);
      }
      await db.$executeRawUnsafe(
        `INSERT INTO "vehicle_onboarding_requests" ("id","providerId","idempotencyKey","status","assetId","leaseToken","leaseExpiresAt","expiresAt","createdAt","updatedAt")
         VALUES ($1::uuid,$2::uuid,$3,$4::"VehicleOnboardingRequestStatus",$5::uuid,$6::uuid, CASE WHEN $7::text IS NULL THEN NULL ELSE now() + $7::interval END, now() + $8::interval, now(), now())`,
        id, PROV_B, "purge-" + id, status, assetId, lease ? randomUUID() : null, lease, expiresIn,
      );
      return { id, assetId };
    };
    const exists = async (id: string) => (await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE id=$1::uuid`, id)) === 1;

    const oldCompleted = await seed("COMPLETED", "-3 days", null, true); // past retention → purge (its vehicle stays)
    const oldCancelled = await seed("CANCELLED", "-2 days", null); // past retention → purge
    const oldAbandoned = await seed("PENDING", "-1 day", null); // past retention, lease released → purge
    const oldStale = await seed("PENDING", "-1 hour", "-10 minutes"); // past retention, lease long expired → purge
    const inProgress = await seed("PENDING", "-1 hour", "90 seconds"); // past "retention" but BEING WORKED ON → keep
    const freshCompleted = await seed("COMPLETED", "29 days", null); // within retention → keep
    const freshCancelled = await seed("CANCELLED", "29 days", null); // within retention → keep
    const freshPending = await seed("PENDING", "29 days", "90 seconds"); // active → keep

    // BOUNDED: one run removes at most the batch, oldest-expired first.
    expect(await purgeExpiredOnboardingRequests({ batchSize: 1 })).toEqual({ purged: 1 });
    expect(await exists(oldCompleted.id)).toBe(false);
    expect(await exists(oldCancelled.id)).toBe(true);

    expect(await purgeExpiredOnboardingRequests()).toEqual({ purged: 3 });
    for (const gone of [oldCancelled, oldAbandoned, oldStale]) expect(await exists(gone.id)).toBe(false);
    for (const kept of [inProgress, freshCompleted, freshCancelled, freshPending]) expect(await exists(kept.id)).toBe(true);
    expect(await purgeExpiredOnboardingRequests()).toEqual({ purged: 0 }); // idempotent

    // Purging a request never touches the vehicle it once produced.
    expect(await assetExists(oldCompleted.assetId!)).toBe(true);
    // And nothing created by the live tests above (all within retention) was removed.
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE "providerId"=$1::uuid`, PROV_A)).toBeGreaterThan(20);

    await db.$executeRawUnsafe(`DELETE FROM "vehicle_onboarding_requests" WHERE "idempotencyKey" LIKE 'purge-%'`);
    await db.$executeRawUnsafe(`DELETE FROM "assets" WHERE id=$1::uuid`, oldCompleted.assetId);
  });

  it("a phone photo with GPS/EXIF is stored NORMALIZED: re-encoded JPEG, upright, no metadata; the shell stays blank (no OCR)", async () => {
    const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 20 } } })
      .jpeg({ quality: 80 })
      .withExif({ IFD0: { Make: "SyntheticPhoneCo", Model: "TestPhone 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "23/1 35/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "58/1 24/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(photo.includes("SyntheticPhoneCo")).toBe(true);

    const { json } = await post(PROV_A, uploadRequest(newKey(), ab(photo), "image/jpeg", "IMG_0001.jpg"));
    expect(json).toMatchObject({ ok: true, replayed: false });
    const id = vehicleIdOf(json);
    const doc = (await docsFor(id))[0]!;
    expect(doc.mimeType).toBe("image/jpeg");
    expect(doc.objectKey.endsWith(".jpg")).toBe(true);

    const storedBytes = Buffer.from(state.storage.get(doc.objectKey)!);
    expect(doc.sizeBytes).toBe(storedBytes.byteLength);
    const meta = await sharp(storedBytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 900, height: 1600 }); // orientation applied
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    for (const needle of ["Exif", "SyntheticPhoneCo", "TestPhone", "GPS"]) expect(storedBytes.includes(needle)).toBe(false);

    // A photo is NOT read automatically (no OCR): the shell is blank and nothing was extracted into it.
    const v = (await q<Record<string, unknown>>(`SELECT make, model, "modelYear", "registrationNumber" FROM "vehicles" WHERE "assetId"=$1::uuid`, id))[0]!;
    expect(Object.values(v).every((x) => x === null)).toBe(true);
    const ext = await q<{ status: string }>(`SELECT status::text FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id);
    expect(ext.every((e) => e.status !== "EXTRACTED")).toBe(true);
  }, 60_000);

  it("a refused file (HEIC / renamed / corrupt) creates NO shell and NO object, and leaves the key retryable", async () => {
    const key = newKey();
    const before = { assets: await assetCount(), docs: await tableCount("asset_documents"), tasks: await tableCount("private_object_cleanup_tasks") };
    const cases: [ArrayBuffer, string, string][] = [
      [isoBmffHeader("heic"), "image/heic", "HEIC_UNSUPPORTED"],
      [isoBmffHeader("heic"), "image/jpeg", "HEIC_UNSUPPORTED"],
      [PDF(), "image/png", "SIGNATURE_MISMATCH"],
      [new TextEncoder().encode("%PDF-1.4\nnot a pdf\n").buffer as ArrayBuffer, "application/pdf", "PDF_CORRUPT"],
    ];
    for (const [body, type, code] of cases) expect(await post(PROV_A, uploadRequest(key, body, type, "x"))).toEqual({ status: 400, json: { ok: false, error: code } });
    expect(state.uploaded).toEqual([]);
    expect({ assets: await assetCount(), docs: await tableCount("asset_documents"), tasks: await tableCount("private_object_cleanup_tasks") }).toEqual(before);
    expect(await requestsFor(PROV_A, key)).toHaveLength(1); // one request, still open
    expect((await requestsFor(PROV_A, key))[0]).toMatchObject({ status: "PENDING", assetId: null, leaseToken: null });
    expect(keep(await as(PROV_A, () => start(key)))).toMatchObject({ ok: true, replayed: false }); // a valid file with the same key
  });

  it("an unauthenticated request is refused before anything is claimed, read or stored", async () => {
    const key = newKey();
    const res = await POST(uploadRequest(key, PDF())); // no session
    expect(res.status).toBe(401);
    expect(state.uploaded).toEqual([]);
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE "idempotencyKey"=$1`, key)).toBe(0);
  });

  it("the request key is stored ONLY on the request row; it never appears in an asset, the audit trail, the cleanup outbox or a storage key", async () => {
    const key = "leakcheck-" + randomUUID();
    const res = keep(await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "private-name.pdf", declaredMimeType: "application/pdf", bytes: PDF() })));
    if (!res.ok) throw new Error("start failed");
    expect(await as(PROV_A, () => deleteDraftVehicle(res.vehicleId))).toEqual({ ok: true }); // also exercises the cancel audit
    expect(await as(PROV_A, () => cancelVehicleOnboardingRequest("leakcheck2-" + key))).toEqual({ ok: true }); // and the request-cancel audit
    expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE "previousValue"::text LIKE $1 OR "newValue"::text LIKE $1`, `%leakcheck%`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE "newValue"::text LIKE '%asset-documents/%' OR "newValue"::text LIKE '%private-name%'`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey" LIKE '%leakcheck%'`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "objectKey" LIKE '%leakcheck%' OR "objectKey" LIKE '%private-name%'`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE "idempotencyKey" LIKE 'leakcheck%'`)).toBe(2);
  });

  it("(13) NO caller ever received a raw database error — every answer in this suite is a fixed, documented shape", async () => {
    expect(answers.length).toBeGreaterThan(80);
    const raw = JSON.stringify(answers);
    expect(raw).not.toMatch(/prisma|P20\d\d|constraint|duplicate key|violates|SQLSTATE|deadlock|vehicle_onboarding_requests|idempotencyKey/i);
    const ALLOWED = new Set(["ONBOARDING_CANCELLED", "ONBOARDING_IN_PROGRESS", "UNKNOWN_ERROR", "UPLOAD_FAILED", "HEIC_UNSUPPORTED", "SIGNATURE_MISMATCH", "PDF_CORRUPT", "NOT_CANCELLABLE"]);
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      if ("json" in o) return walk(o.json);
      if (o.ok === true) {
        expect(Object.keys(o).filter((k) => !["ok", "vehicleId", "replayed", "redirectTo"].includes(k))).toEqual([]);
      } else if (o.ok === false) {
        expect(Object.keys(o).sort().join(",")).toMatch(/^(code|error),ok$/);
        expect(ALLOWED.has(String(o.error ?? o.code))).toBe(true);
      }
    };
    walk(answers);
  });

  it("(14) onboarding writes nothing to Booking / VehicleReservation / offering / service / pricing / payment / vertical / category tables", async () => {
    for (const t of ["bookings", "vehicle_reservations", "rental_vehicle_day_reservations", "rental_vehicle_day_hold_groups", "rental_offerings", "guided_tour_vehicle_offerings", "services", "prices", "payments", "commissions", "provider_verticals", "provider_categories", "tour_service_vehicles"]) {
      expect(await tableCount(t), t).toBe(0);
    }
    // Every shell created here is non-public and unverified: nothing was activated or approved.
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE status <> 'REGISTERED'`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE "verificationStatus" = 'APPROVED'`)).toBe(0);
    // Every COMPLETED request points at a live asset; every CANCELLED one points at nothing.
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" r WHERE r.status='COMPLETED' AND NOT EXISTS (SELECT 1 FROM "assets" a WHERE a.id=r."assetId")`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "vehicle_onboarding_requests" WHERE status='CANCELLED' AND "assetId" IS NOT NULL`)).toBe(0);
    await noOrphanObjects();
  });
});
