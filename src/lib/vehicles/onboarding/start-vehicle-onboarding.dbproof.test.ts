import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { buildSyntheticPdf, isoBmffHeader, SYNTHETIC_REGISTRATION_LINES } from "@/lib/vehicles/documents/synthetic-test-documents";

// Phase 3C Slice 3B (mobile-upload + idempotency hardening) — REAL-PostgreSQL proof of server-side
// upload idempotency. Two SIMULTANEOUS upload requests go through the ACTUAL route handler →
// startVehicleOnboarding → the real unique index, the real transaction, the real audit table, the
// real cleanup outbox, the real image/PDF preparation and the real native-PDF extraction. Only the
// session (which provider is signed in) and the storage bucket (an in-memory fake — no network, no
// real document) are substituted. Everything uploaded is synthetic.
//
// Gated behind REGISTRATION_DBPROOF=1 so the default suite never touches a database:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/onboarding/start-vehicle-onboarding.dbproof.test.ts
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
      barrier: null as null | { want: number; waiting: (() => void)[] },
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
// FAKE private bucket. An optional barrier holds every upload until N are in flight, which
// guarantees the racing requests have ALL passed the replay fast-path before any of them commits —
// so the unique index (not timing luck) is what arbitrates.
vi.mock("@/lib/storage/storage", () => {
  class StorageNotConfiguredError extends Error {}
  return {
    StorageNotConfiguredError,
    isDocumentStorageConfigured: () => true,
    uploadPrivateObject: async (p: { objectKey: string; body: ArrayBuffer }) => {
      state.uploaded.push(p.objectKey);
      state.storage.set(p.objectKey, p.body);
      const b = state.barrier;
      if (b) {
        await new Promise<void>((resolve) => {
          b.waiting.push(resolve);
          if (b.waiting.length >= b.want) b.waiting.splice(0).forEach((r) => r());
          else setTimeout(resolve, 3000); // never deadlock if a peer was answered by the fast path
        });
      }
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
const { deleteDraftVehicle } = await import("./delete-draft-vehicle");
const { runPrivateObjectCleanup } = await import("@/lib/storage/cleanup/private-object-cleanup");

let admin: PrismaClient, db: PrismaClient;

const ab = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const PDF = () => buildSyntheticPdf([SYNTHETIC_REGISTRATION_LINES]);
const newKey = () => randomUUID();

function uploadRequest(requestKey: string, body: ArrayBuffer, type = "application/pdf", name = "synthetic-registration.pdf") {
  const form = new FormData();
  form.set("locale", "en");
  form.set("requestKey", requestKey);
  form.set("file", new File([body], name, { type }));
  return new Request("https://barq.test/api/provider/vehicles/onboarding/upload", { method: "POST", body: form, headers: { accept: "application/json" } });
}
type Json = { ok: boolean; redirectTo?: string; replayed?: boolean; error?: string };
const vehicleIdOf = (json: Json) => json.redirectTo!.split("/").pop()!.split("?")[0]!;

const q = <T>(sql: string, ...params: unknown[]) => db.$queryRawUnsafe(sql, ...params) as Promise<T[]>;
const n = async (sql: string, ...params: unknown[]) => Number((await q<{ n: number }>(sql, ...params))[0]!.n);
const assetsForKey = (prov: string, key: string) => q<{ id: string }>(`SELECT id FROM "assets" WHERE "providerId"=$1::uuid AND "onboardingRequestKey"=$2`, prov, key);
const docsFor = (assetId: string) => q<{ id: string; objectKey: string; mimeType: string; sizeBytes: number }>(`SELECT id,"objectKey","mimeType","sizeBytes" FROM "asset_documents" WHERE "assetId"=$1::uuid`, assetId);
const createdAudits = (assetId: string) => n(`SELECT count(*)::int n FROM "audit_logs" WHERE action='vehicle.onboarding_draft_created' AND "entityId"=$1::uuid`, assetId);
const pendingCleanup = () => n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE status <> 'COMPLETED'`);
const tableCount = (t: string) => n(`SELECT count(*)::int n FROM "${t}"`);

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
  state.barrier = null;
});

describe.skipIf(!RUN)("document-first onboarding — upload idempotency on real PostgreSQL", () => {
  it("the unique index exists, permits many NULL keys (legacy assets) and rejects a duplicate (provider, key)", async () => {
    const idx = await q<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename='assets' AND indexname='assets_providerId_onboardingRequestKey_key'`);
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef).toMatch(/CREATE UNIQUE INDEX/);

    const insert = (prov: string, key: string | null) =>
      db.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","onboardingRequestKey","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'REGISTERED'::"AssetStatus",'DRAFT'::"AssetVerificationStatus",$3,now(),now())`, randomUUID(), prov, key);
    await insert(PROV_A, null);
    await insert(PROV_A, null); // legacy rows: NULL never collides
    const key = "raw-" + randomUUID();
    await insert(PROV_A, key);
    await expect(insert(PROV_A, key)).rejects.toThrow(/unique|23505|P2010/i);
    await insert(PROV_B, key); // the same key under another provider is a different row
    await db.$executeRawUnsafe(`DELETE FROM "assets" WHERE "onboardingRequestKey" IS NULL OR "onboardingRequestKey"=$1`, key);
  });

  it("TWO SIMULTANEOUS UPLOAD REQUESTS with the same key → ONE shell, ONE document graph, ONE audit, ONE stored object", async () => {
    for (let round = 0; round < 8; round++) {
      state.uploaded.length = 0; state.removed.length = 0;
      state.barrier = { want: 2, waiting: [] }; // both requests are past the replay fast-path before either commits
      const key = newKey();
      const [r1, r2] = await as(PROV_A, () => Promise.all([POST(uploadRequest(key, PDF())), POST(uploadRequest(key, PDF()))]));
      state.barrier = null;
      const [j1, j2] = [(await r1.json()) as Json, (await r2.json()) as Json];

      // Both callers get the SAME safe success — never a raw database error.
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(j1.ok && j2.ok).toBe(true);
      expect(vehicleIdOf(j1)).toBe(vehicleIdOf(j2));
      expect([j1.replayed, j2.replayed].sort()).toEqual([false, true]); // exactly one created it
      for (const j of [j1, j2]) expect(JSON.stringify(j)).not.toContain(key);

      const assets = await assetsForKey(PROV_A, key);
      expect(assets).toHaveLength(1);
      const id = assets[0]!.id;
      expect(id).toBe(vehicleIdOf(j1));
      expect(await n(`SELECT count(*)::int n FROM "vehicles" WHERE "assetId"=$1::uuid`, id)).toBe(1);
      const docs = await docsFor(id);
      expect(docs).toHaveLength(1);
      expect(await createdAudits(id)).toBe(1);
      // The stored object is the full document (never an emptied buffer) and was read exactly once.
      expect(docs[0]!.sizeBytes).toBe(PDF().byteLength);
      expect(state.storage.get(docs[0]!.objectKey)!.byteLength).toBe(docs[0]!.sizeBytes);
      const extractions = await q<{ status: string }>(`SELECT status FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id);
      expect(extractions).toHaveLength(1);
      expect(extractions[0]!.status).not.toBe("FAILED");

      // Storage: both requests wrote an object; ONLY the authoritative one remains, the loser's is gone.
      expect(state.uploaded).toHaveLength(2);
      expect(state.removed).toHaveLength(1);
      expect(state.removed[0]).not.toBe(docs[0]!.objectKey);
      expect([...state.storage.keys()].filter((k) => state.uploaded.includes(k))).toEqual([docs[0]!.objectKey]);
      // …and nothing is left pending: the winner's intent was released, the loser's task completed.
      expect(await pendingCleanup()).toBe(0);
      expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey"=$1 AND status='COMPLETED'`, state.removed[0]!)).toBe(1);
      expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey"=$1`, docs[0]!.objectKey)).toBe(0);
    }
  }, 240_000);

  it("five simultaneous same-key starts (no barrier, natural timing) still produce exactly one setup", async () => {
    for (let round = 0; round < 4; round++) {
      const key = newKey();
      const results = await as(PROV_A, () =>
        Promise.all(Array.from({ length: 5 }, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }))),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(new Set(results.map((r) => (r.ok ? r.vehicleId : "x"))).size).toBe(1);
      expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
      const assets = await assetsForKey(PROV_A, key);
      expect(assets).toHaveLength(1);
      expect(await docsFor(assets[0]!.id)).toHaveLength(1);
      expect(await createdAudits(assets[0]!.id)).toBe(1);
      expect(await pendingCleanup()).toBe(0);
    }
  }, 240_000);

  it("a REPLAY returns the same setup: no new upload, no second audit, and the replayed (different) file does NOT replace the document", async () => {
    const key = newKey();
    const first = (await (await as(PROV_A, () => POST(uploadRequest(key, PDF())))).json()) as Json;
    expect(first).toMatchObject({ ok: true, replayed: false });
    const id = vehicleIdOf(first);
    const before = (await docsFor(id))[0]!;

    state.uploaded.length = 0;
    const otherFile = ab(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#336699" } }).jpeg().toBuffer());
    const replay = (await (await as(PROV_A, () => POST(uploadRequest(key, otherFile, "image/jpeg", "different.jpg")))).json()) as Json;
    expect(replay).toEqual({ ok: true, redirectTo: `/provider/vehicles/new/${id}?resumed=1`, replayed: true });

    expect(state.uploaded).toEqual([]); // the replayed file never reached storage
    expect((await docsFor(id))[0]).toEqual(before); // same document, same object, same type
    expect(await createdAudits(id)).toBe(1);
    expect(await assetsForKey(PROV_A, key)).toHaveLength(1);
  });

  it("the key is PROVIDER-SCOPED: another provider using the same key gets its own setup and can never reach the first", async () => {
    const key = newKey();
    const a = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "a.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    const b = await as(PROV_B, () => startVehicleOnboarding({ requestKey: key, originalFilename: "b.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(b).toMatchObject({ ok: true, replayed: false }); // NOT a replay of A's setup
    if (!a.ok || !b.ok) return;
    expect(b.vehicleId).not.toBe(a.vehicleId);
    expect((await q<{ providerId: string }>(`SELECT "providerId" FROM "assets" WHERE id=$1::uuid`, a.vehicleId))[0]!.providerId).toBe(PROV_A);
    expect((await q<{ providerId: string }>(`SELECT "providerId" FROM "assets" WHERE id=$1::uuid`, b.vehicleId))[0]!.providerId).toBe(PROV_B);
    // B replaying the key resolves to B's own setup only.
    expect(await as(PROV_B, () => startVehicleOnboarding({ requestKey: key, originalFilename: "b.pdf", declaredMimeType: "application/pdf", bytes: PDF() }))).toEqual({ ok: true, vehicleId: b.vehicleId, replayed: true });
    // And B cannot cancel A's setup by id.
    expect(await as(PROV_B, () => deleteDraftVehicle(a.vehicleId))).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
  });

  it("two providers racing with the SAME key concurrently each get their own setup", async () => {
    const key = newKey();
    state.barrier = { want: 2, waiting: [] };
    const [a, b] = await Promise.all([
      as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "a.pdf", declaredMimeType: "application/pdf", bytes: PDF() })),
      as(PROV_B, () => startVehicleOnboarding({ requestKey: key, originalFilename: "b.pdf", declaredMimeType: "application/pdf", bytes: PDF() })),
    ]);
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(b).toMatchObject({ ok: true, replayed: false });
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE "onboardingRequestKey"=$1`, key)).toBe(2);
  });

  it("two DIFFERENT keys from one provider are two independent setups", async () => {
    const [k1, k2] = [newKey(), newKey()];
    const [a, b] = await as(PROV_A, () =>
      Promise.all([
        startVehicleOnboarding({ requestKey: k1, originalFilename: "1.pdf", declaredMimeType: "application/pdf", bytes: PDF() }),
        startVehicleOnboarding({ requestKey: k2, originalFilename: "2.pdf", declaredMimeType: "application/pdf", bytes: PDF() }),
      ]),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.vehicleId).not.toBe(b.vehicleId);
    expect(a.replayed || b.replayed).toBe(false);
    expect(await docsFor(a.vehicleId)).toHaveLength(1);
    expect(await docsFor(b.vehicleId)).toHaveLength(1);
  });

  it("a STALE key cannot overwrite a confirmed vehicle or its document", async () => {
    const key = newKey();
    const started = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    if (!started.ok) throw new Error("start failed");
    const id = started.vehicleId;
    // The vehicle has since been confirmed and submitted (values written by the reviewed finalize).
    await db.$executeRawUnsafe(`UPDATE "vehicles" SET make='Toyota', model='Testcruiser', "registrationNumber"=$2 WHERE "assetId"=$1::uuid`, id, "T-" + id.slice(0, 8));
    await db.$executeRawUnsafe(`UPDATE "assets" SET "verificationStatus"='SUBMITTED'::"AssetVerificationStatus" WHERE id=$1::uuid`, id);
    const docBefore = (await docsFor(id))[0]!;

    state.uploaded.length = 0;
    const replay = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "other.pdf", declaredMimeType: "application/pdf", bytes: buildSyntheticPdf([["Vehicle Make: Other", "Plate Number: X 1"]]) }));
    expect(replay).toEqual({ ok: true, vehicleId: id, replayed: true });
    expect(state.uploaded).toEqual([]);
    const v = (await q<{ make: string; model: string }>(`SELECT make, model FROM "vehicles" WHERE "assetId"=$1::uuid`, id))[0]!;
    expect(v).toEqual({ make: "Toyota", model: "Testcruiser" });
    expect((await q<{ verificationStatus: string }>(`SELECT "verificationStatus" FROM "assets" WHERE id=$1::uuid`, id))[0]!.verificationStatus).toBe("SUBMITTED");
    expect((await docsFor(id))[0]).toEqual(docBefore);
    expect(await assetsForKey(PROV_A, key)).toHaveLength(1);
  });

  it("AUDIT FAILURE rolls the whole start back: no shell, no document, no stranded object — and the same key can then succeed", async () => {
    const key = newKey();
    state.failAuditFor = PROV_A;
    const failed = (await as(PROV_A, () => POST(uploadRequest(key, PDF())))) as Response;
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "UNKNOWN_ERROR" }); // a safe code, not a database error
    expect(await assetsForKey(PROV_A, key)).toHaveLength(0);
    expect(state.uploaded).toHaveLength(1);
    expect(state.removed).toEqual(state.uploaded); // the uploaded object was removed
    expect(state.storage.has(state.uploaded[0]!)).toBe(false);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "objectKey"=$1`, state.uploaded[0]!)).toBe(0);
    expect(await pendingCleanup()).toBe(0);

    const retry = (await (await as(PROV_A, () => POST(uploadRequest(key, PDF())))).json()) as Json;
    expect(retry).toMatchObject({ ok: true, replayed: false });
    expect(await createdAudits(vehicleIdOf(retry))).toBe(1);
  });

  it("a failed start whose object ALSO cannot be deleted leaves it DURABLY queued; the worker later removes it", async () => {
    const key = newKey();
    state.failAuditFor = PROV_A;
    state.removeMode = "transient"; // storage delete fails right after the rollback
    const res = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    expect(res).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    const orphan = state.uploaded[0]!;
    expect(state.storage.has(orphan)).toBe(true); // still in the bucket…
    const task = await q<{ status: string; attemptCount: number }>(`SELECT status,"attemptCount" FROM "private_object_cleanup_tasks" WHERE "objectKey"=$1`, orphan);
    expect(task).toHaveLength(1); // …but durably recorded for retry
    expect(task[0]!.status).toBe("PENDING");
    expect(task[0]!.attemptCount).toBe(1);

    state.removeMode = "ok";
    await db.$executeRawUnsafe(`UPDATE "private_object_cleanup_tasks" SET "nextAttemptAt"=now() - interval '1 minute' WHERE "objectKey"=$1`, orphan);
    const summary = await runPrivateObjectCleanup();
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(state.storage.has(orphan)).toBe(false);
    expect(await pendingCleanup()).toBe(0);
  });

  it("cancelling an unfinished setup frees its key: the same key then starts a NEW setup (reload/resume before that returns the old one)", async () => {
    const key = newKey();
    const first = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    if (!first.ok) throw new Error("start failed");
    // Resume: the key resolves to the unfinished setup, as many times as asked.
    for (let i = 0; i < 2; i++) expect(await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }))).toEqual({ ok: true, vehicleId: first.vehicleId, replayed: true });
    const oldObject = (await docsFor(first.vehicleId))[0]!.objectKey;

    expect(await as(PROV_A, () => deleteDraftVehicle(first.vehicleId))).toEqual({ ok: true });
    expect(state.storage.has(oldObject)).toBe(false);

    const second = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    expect(second).toMatchObject({ ok: true, replayed: false });
    if (second.ok) expect(second.vehicleId).not.toBe(first.vehicleId);
    expect(await assetsForKey(PROV_A, key)).toHaveLength(1);
  });

  it("a phone photo with GPS/EXIF is stored NORMALIZED: re-encoded JPEG, upright, no metadata; the shell stays blank", async () => {
    const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 20 } } })
      .jpeg({ quality: 80 })
      .withExif({ IFD0: { Make: "SyntheticPhoneCo", Model: "TestPhone 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "23/1 35/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "58/1 24/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(photo.includes("SyntheticPhoneCo")).toBe(true);

    const json = (await (await as(PROV_A, () => POST(uploadRequest(newKey(), ab(photo), "image/jpeg", "IMG_0001.jpg")))).json()) as Json;
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
    const ext = await q<{ status: string }>(`SELECT status FROM "vehicle_registration_extractions" WHERE "assetId"=$1::uuid`, id);
    expect(ext.every((e) => e.status !== "EXTRACTED")).toBe(true);
  }, 60_000);

  it("a refused file (HEIC / renamed / corrupt) creates NO rows and NO object, and does not consume the key", async () => {
    const key = newKey();
    const before = { assets: await tableCount("assets"), docs: await tableCount("asset_documents"), tasks: await tableCount("private_object_cleanup_tasks") };
    const cases: [ArrayBuffer, string, string][] = [
      [isoBmffHeader("heic"), "image/heic", "HEIC_UNSUPPORTED"],
      [isoBmffHeader("heic"), "image/jpeg", "HEIC_UNSUPPORTED"],
      [PDF(), "image/png", "SIGNATURE_MISMATCH"],
      [new TextEncoder().encode("%PDF-1.4\nnot a pdf\n").buffer as ArrayBuffer, "application/pdf", "PDF_CORRUPT"],
    ];
    for (const [body, type, code] of cases) {
      const res = await as(PROV_A, () => POST(uploadRequest(key, body, type, "x")));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: code });
    }
    expect(state.uploaded).toEqual([]);
    expect({ assets: await tableCount("assets"), docs: await tableCount("asset_documents"), tasks: await tableCount("private_object_cleanup_tasks") }).toEqual(before);
    // The key was never consumed: a valid file with it now starts the setup.
    expect(await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "r.pdf", declaredMimeType: "application/pdf", bytes: PDF() }))).toMatchObject({ ok: true, replayed: false });
  });

  it("an unauthenticated request is refused before anything is read or stored", async () => {
    const res = await POST(uploadRequest(newKey(), PDF())); // no session
    expect(res.status).toBe(401);
    expect(state.uploaded).toEqual([]);
  });

  it("the request key is stored ONLY on the asset row; it never appears in the audit trail or the cleanup outbox", async () => {
    const key = "leakcheck-" + randomUUID();
    const res = await as(PROV_A, () => startVehicleOnboarding({ requestKey: key, originalFilename: "private-name.pdf", declaredMimeType: "application/pdf", bytes: PDF() }));
    expect(res.ok).toBe(true);
    expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE "previousValue"::text LIKE $1 OR "newValue"::text LIKE $1`, `%${key}%`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "audit_logs" WHERE "newValue"::text LIKE '%asset-documents/%' OR "newValue"::text LIKE '%private-name%'`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "private_object_cleanup_tasks" WHERE "objectKey" LIKE $1`, `%${key}%`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "asset_documents" WHERE "objectKey" LIKE $1 OR "objectKey" LIKE '%private-name%'`, `%${key}%`)).toBe(0);
  });

  it("onboarding writes nothing to Booking / reservation / offering / service / pricing / vertical / category tables", async () => {
    for (const t of ["bookings", "rental_vehicle_day_reservations", "rental_offerings", "services", "prices", "provider_verticals", "provider_categories", "tour_service_vehicles"]) {
      expect(await tableCount(t)).toBe(0);
    }
    // Every shell created here is non-public and unverified: nothing was activated or approved.
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE status <> 'REGISTERED'`)).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM "assets" WHERE "verificationStatus" = 'APPROVED'`)).toBe(0);
  });
});
