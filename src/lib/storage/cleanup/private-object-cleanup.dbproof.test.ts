import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildSyntheticPdf } from "@/lib/vehicles/documents/synthetic-test-documents";

// Phase 3C Slice 3B (durable-cleanup correction) — REAL-Postgres proof of the private-object cleanup
// outbox, with FAKE storage responses (no network, no real document). Gated behind
// REGISTRATION_DBPROOF=1:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/storage/cleanup/private-object-cleanup.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";

const PROJECT = process.cwd();
const dbName = "barq_cleanup_dbproof_" + randomUUID().slice(0, 8);
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

// FAKE storage: records every delete target + simulates ok / not-found / transient per mode.
const deletedKeys: string[] = [];
const uploadedKeys: string[] = [];
let storageMode: "ok" | "notfound" | "transient" = "ok";
class StorageNotConfiguredError extends Error {}
vi.mock("@/lib/storage/storage", () => ({
  StorageNotConfiguredError,
  isDocumentStorageConfigured: () => true,
  uploadPrivateObject: async (p: { objectKey: string }) => { uploadedKeys.push(p.objectKey); },
  removePrivateObject: async (objectKey: string) => {
    deletedKeys.push(objectKey);
    if (storageMode === "notfound") throw new Error("Object not found: " + objectKey);
    if (storageMode === "transient") throw new Error("ECONNRESET temporary 503");
  },
}));

const PROV = randomUUID();
const auditMock = vi.fn(async (...a: unknown[]): Promise<void> => { void a; });
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: async () => ({ barqUser: { id: randomUUID() }, provider: { id: PROV, status: "APPROVED" } }),
  ForbiddenError: class extends Error {},
  UnauthenticatedError: class extends Error {},
}));
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({ canViewRentalWorkspace: async () => true }));
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const cleanup = await import("./private-object-cleanup");
const { enqueuePrivateObjectCleanup, attemptPrivateObjectCleanup, runPrivateObjectCleanup, registerUploadIntent, releaseUploadIntent } = cleanup;
const { deleteDraftVehicle } = await import("@/lib/vehicles/onboarding/delete-draft-vehicle");
const { finalizeVehicleFromRegistration } = await import("@/lib/vehicles/onboarding/finalize-vehicle");
const { replaceVehicleDocument } = await import("@/lib/vehicles/documents/replace-vehicle-document");

const fullWith = (plate: string): Record<string, unknown> => ({
  make: "Toyota", model: "Prado", modelYear: "2019", color: "White",
  bookablePassengerCapacity: "13", licensedPassengerCapacity: "13", registeredSeats: "15",
  plateNumber: plate, vin: "JTEBU29J8K5012345", licenseExpiry: "31/05/2027", vehicleType: "SUV", declarationAccepted: "true",
});
// A real, parseable synthetic PDF (fictional content) — never a real document. It must be
// structurally valid: a replaced registration document now passes the bounded-parser check.
const SYNTHETIC_PDF = buildSyntheticPdf([["TEST DOCUMENT - synthetic fixture"]]);

let admin: PrismaClient, db: PrismaClient;

async function seedShell(vehId: string, objectKey: string, opts: { submitted?: boolean } = {}) {
  const docId = randomUUID(), extId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'REGISTERED'::"AssetStatus",'DRAFT'::"AssetVerificationStatus",now(),now())`, vehId, PROV);
    await tx.$executeRawUnsafe(`INSERT INTO "vehicles" ("assetId","createdAt","updatedAt") VALUES ($1::uuid,now(),now())`, vehId);
    await tx.$executeRawUnsafe(`INSERT INTO "asset_documents" ("id","assetId","type","objectKey","originalFilename","mimeType","sizeBytes","status","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE_REGISTRATION',$3,'r.pdf','application/pdf',100,'PENDING'::"AssetDocumentStatus",now(),now())`, docId, vehId, objectKey);
    await tx.$executeRawUnsafe(`INSERT INTO "vehicle_registration_extractions" ("id","assetId","assetDocumentId","documentSha256","parserVersion","source","status","fields","version","attemptCount","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,'sha','1.0.0','NATIVE_PDF_TEXT','EXTRACTED'::"VehicleRegistrationExtractionStatus",'{}'::jsonb,0,1,now(),now())`, extId, vehId, docId);
    if (opts.submitted) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "vehicle_registration_confirmations" ("id","providerId","assetId","assetDocumentId","extractionId","boundDocumentSha256","boundParserVersion","status","declarationAccepted","version","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'sha','1.0.0','SUBMITTED'::"VehicleRegistrationConfirmationStatus",true,0,now(),now())`,
        randomUUID(), PROV, vehId, docId, extId,
      );
    }
  });
  return { docId };
}
const taskRows = async (objectKey: string) =>
  (await db.$queryRawUnsafe(`SELECT id,status,"attemptCount","nextAttemptAt" FROM "private_object_cleanup_tasks" WHERE "objectKey"=$1`, objectKey)) as { id: string; status: string; attemptCount: number; nextAttemptAt: Date }[];
const tableCount = async (t: string) => Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`)) as { n: number }[])[0]!.n);
const assetExists = async (id: string) => Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "assets" WHERE id=$1::uuid`, id)) as { n: number }[])[0]!.n) === 1;

beforeAll(async () => {
  if (!RUN) return;
  admin = new PrismaClient({ datasources: { db: { url: urls().admin } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: PROJECT, stdio: "ignore", env: { ...process.env, DATABASE_URL: throwawayUrl, DIRECT_URL: throwawayUrl } });
  db = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, PROV, randomUUID());
  });
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.$disconnect();
});

beforeEach(() => { deletedKeys.length = 0; uploadedKeys.length = 0; storageMode = "ok"; auditMock.mockReset(); auditMock.mockResolvedValue(undefined); });

describe.skipIf(!RUN)("private-object cleanup — real Postgres, fake storage", () => {
  it("(1,4) cancellation creates exactly one cleanup task for the old object; immediate success resolves it", async () => {
    const veh = randomUUID(); const key = "k/" + veh + ".pdf";
    await seedShell(veh, key);
    expect(await deleteDraftVehicle(veh)).toEqual({ ok: true });
    const rows = await taskRows(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("COMPLETED");
    expect(deletedKeys).toEqual([key]);
    expect(await assetExists(veh)).toBe(false);
  });

  it("(2) audit failure rolls back BOTH the graph deletion and the cleanup-task creation", async () => {
    const veh = randomUUID(); const key = "k/" + veh + ".pdf";
    await seedShell(veh, key);
    auditMock.mockRejectedValueOnce(new Error("audit boom"));
    expect(await deleteDraftVehicle(veh)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(await taskRows(key)).toHaveLength(0); // no durable task
    expect(await assetExists(veh)).toBe(true); // (3) graph intact
    expect(deletedKeys).toEqual([]); // nothing deleted
  });

  it("(5,11) storage failure leaves exactly one retryable task; a later worker run increments + reschedules", async () => {
    const veh = randomUUID(); const key = "k/" + veh + ".pdf";
    storageMode = "transient";
    await seedShell(veh, key);
    expect(await deleteDraftVehicle(veh)).toEqual({ ok: true }); // cancel succeeds even if storage fails
    let rows = await taskRows(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("PENDING");
    expect(rows[0]!.attemptCount).toBe(1);
    // Force it due, run the worker again → another attempt, attemptCount increments, still one row.
    await db.$executeRawUnsafe(`UPDATE "private_object_cleanup_tasks" SET "nextAttemptAt"=now() - interval '1 minute' WHERE "objectKey"=$1`, key);
    await runPrivateObjectCleanup();
    rows = await taskRows(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attemptCount).toBe(2);
  });

  it("(5→success) once storage recovers, the worker resolves the retryable task to COMPLETED", async () => {
    const veh = randomUUID(); const key = "k/" + veh + ".pdf";
    storageMode = "transient";
    await seedShell(veh, key);
    await deleteDraftVehicle(veh);
    storageMode = "ok";
    await db.$executeRawUnsafe(`UPDATE "private_object_cleanup_tasks" SET "nextAttemptAt"=now() - interval '1 minute' WHERE "objectKey"=$1`, key);
    await runPrivateObjectCleanup();
    expect((await taskRows(key))[0]!.status).toBe("COMPLETED");
  });

  it("(6) a repeated enqueue of the same key never creates a duplicate task", async () => {
    const key = "k/dup-" + randomUUID();
    await db.$transaction((tx) => enqueuePrivateObjectCleanup(tx, { objectKey: key, purpose: "VEHICLE_DOCUMENT_REPLACEMENT" }));
    await db.$transaction((tx) => enqueuePrivateObjectCleanup(tx, { objectKey: key, purpose: "VEHICLE_DOCUMENT_REPLACEMENT" }));
    expect(await taskRows(key)).toHaveLength(1);
  });

  it("(7,8) only the superseded object is queued; the attempt deletes only that key, never a new replacement key", async () => {
    const oldKey = "k/old-" + randomUUID();
    const newKey = "k/new-" + randomUUID();
    const id = await db.$transaction((tx) => enqueuePrivateObjectCleanup(tx, { objectKey: oldKey, purpose: "VEHICLE_DOCUMENT_REPLACEMENT" }));
    expect(await taskRows(newKey)).toHaveLength(0); // the active replacement is never queued
    await attemptPrivateObjectCleanup(id);
    expect(deletedKeys).toEqual([oldKey]); // only the old object was targeted
    expect(deletedKeys).not.toContain(newKey);
  });

  it("(9) two concurrent workers on the same task converge: exactly one delete, one COMPLETED", async () => {
    const key = "k/conc-" + randomUUID();
    const id = await db.$transaction((tx) => enqueuePrivateObjectCleanup(tx, { objectKey: key, purpose: "VEHICLE_REGISTRATION_ONBOARDING" }));
    const [a, b] = await Promise.all([attemptPrivateObjectCleanup(id), attemptPrivateObjectCleanup(id)]);
    expect([a, b].filter((r) => r === "completed").length).toBe(1);
    expect([a, b].filter((r) => r === "skipped").length).toBe(1);
    expect(deletedKeys.filter((k) => k === key)).toHaveLength(1); // storage targeted exactly once
    expect((await taskRows(key))[0]!.status).toBe("COMPLETED");
  });

  it("(10) object-not-found resolves the task as COMPLETED (absent == cleaned)", async () => {
    const key = "k/absent-" + randomUUID();
    storageMode = "notfound";
    const id = await db.$transaction((tx) => enqueuePrivateObjectCleanup(tx, { objectKey: key, purpose: "VEHICLE_REGISTRATION_ONBOARDING" }));
    expect(await attemptPrivateObjectCleanup(id)).toBe("completed");
    expect((await taskRows(key))[0]!.status).toBe("COMPLETED");
  });

  it("(12) a finalized shell (SUBMITTED claim) cancellation is refused and queues NOTHING", async () => {
    const veh = randomUUID(); const key = "k/" + veh + ".pdf";
    await seedShell(veh, key, { submitted: true });
    expect(await deleteDraftVehicle(veh)).toEqual({ ok: false, code: "NOT_DELETABLE" });
    expect(await taskRows(key)).toHaveLength(0);
    expect(await assetExists(veh)).toBe(true);
  });

  it("(intent) an in-flight upload intent is untouched before its grace; a released intent vanishes; an ABANDONED intent is cleaned once due", async () => {
    // In flight: recorded but not due → the worker must not delete an object still being uploaded.
    const inflight = "k/inflight-" + randomUUID();
    await registerUploadIntent(inflight);
    await runPrivateObjectCleanup();
    expect(deletedKeys).not.toContain(inflight);
    expect((await taskRows(inflight))[0]).toMatchObject({ status: "PENDING", attemptCount: 0 });

    // Released in the transaction that persists the row → no task remains, never deleted.
    const persisted = "k/persisted-" + randomUUID();
    await registerUploadIntent(persisted);
    expect(await db.$transaction((tx) => releaseUploadIntent(tx, persisted))).toBe(true);
    expect(await taskRows(persisted)).toHaveLength(0);

    // Abandoned (request died / DB write never happened): once the grace elapses the worker deletes it.
    await db.$executeRawUnsafe(`UPDATE "private_object_cleanup_tasks" SET "nextAttemptAt"=now() - interval '1 minute' WHERE "objectKey"=$1`, inflight);
    await runPrivateObjectCleanup();
    expect(deletedKeys).toContain(inflight);
    expect((await taskRows(inflight))[0]!.status).toBe("COMPLETED");
    expect(deletedKeys).not.toContain(persisted);
  });

  it("(race) finalize ↔ cancel under TRUE concurrency always converges: finalized-and-intact OR cancelled-and-cleaned — never a deleted finalized vehicle, never a half graph", async () => {
    const outcomes = { finalized: 0, cancelled: 0 };
    for (let i = 0; i < 6; i++) {
      const veh = randomUUID(); const key = "k/" + veh + ".pdf";
      await seedShell(veh, key);
      const [f, c] = await Promise.all([finalizeVehicleFromRegistration(veh, fullWith("R " + (10000 + i))), deleteDraftVehicle(veh)]);
      const rows = await taskRows(key);
      const vehicleRows = Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "vehicles" WHERE "assetId"=$1::uuid`, veh)) as { n: number }[])[0]!.n);
      const submitted = Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "vehicle_registration_confirmations" WHERE "assetId"=$1::uuid AND status='SUBMITTED'`, veh)) as { n: number }[])[0]!.n);
      if (await assetExists(veh)) {
        outcomes.finalized += 1;
        expect(f.ok).toBe(true); // the vehicle was finalized…
        expect(c).toEqual({ ok: false, code: "NOT_DELETABLE" }); // …so cancel refused
        expect(vehicleRows).toBe(1);
        expect(submitted).toBe(1);
        expect(rows).toHaveLength(0); // its document was NEVER queued
        expect(deletedKeys).not.toContain(key); // and never deleted
      } else {
        outcomes.cancelled += 1;
        expect(c).toEqual({ ok: true });
        expect(f).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" }); // finalize saw the truth, wrote nothing
        expect(vehicleRows).toBe(0);
        expect(submitted).toBe(0);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("COMPLETED");
        expect(deletedKeys).toContain(key);
      }
    }
    expect(outcomes.finalized + outcomes.cancelled).toBe(6);
  });

  it("(race) replacement ↔ cancel under TRUE concurrency: every object ever written is cleaned; no orphan, no stray task", async () => {
    for (let i = 0; i < 6; i++) {
      deletedKeys.length = 0; uploadedKeys.length = 0;
      const veh = randomUUID(); const oldKey = "k/" + veh + "-old.pdf";
      const { docId } = await seedShell(veh, oldKey);
      await Promise.all([
        replaceVehicleDocument(veh, docId, { originalFilename: "new.pdf", declaredMimeType: "application/pdf", bytes: SYNTHETIC_PDF }),
        deleteDraftVehicle(veh),
      ]);
      expect(await assetExists(veh)).toBe(false); // the shell is gone either way
      for (const key of [oldKey, ...uploadedKeys]) {
        expect(deletedKeys).toContain(key); // old AND any newly-written object are removed
        const rows = await taskRows(key);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("COMPLETED"); // nothing left pending
      }
    }
  }, 60_000); // six rounds, each parsing a real PDF — slow when several database suites run at once

  it("(13) a cleanup run changes no Booking / reservation / offering / service / pricing / vertical rows", async () => {
    const key = "k/noside-" + randomUUID();
    const id = await db.$transaction((tx) => enqueuePrivateObjectCleanup(tx, { objectKey: key, purpose: "VEHICLE_REGISTRATION_ONBOARDING" }));
    await attemptPrivateObjectCleanup(id);
    for (const t of ["bookings", "rental_vehicle_day_reservations", "rental_offerings", "services", "prices", "provider_verticals"]) {
      expect(await tableCount(t)).toBe(0);
    }
  });
});
