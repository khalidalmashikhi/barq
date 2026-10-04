import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Phase 3C Slice 3B — REAL-Postgres proof of finalizeVehicleFromRegistration: exactly-once
// authoritative application under true two-client concurrency, documented conflict (never a raw
// Prisma error), version-CAS protection, duplicate-plate whole-tx rollback, audit-failure rollback,
// document-replacement supersession, finalize/cancel convergence, and zero collateral writes to
// Booking / VehicleReservation / offering / service / pricing / vertical tables.
//
// Gated behind REGISTRATION_DBPROOF=1 so the default suite never touches a database:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/onboarding/finalize-vehicle.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";

const PROJECT = process.cwd();
const dbName = "barq_finalize_dbproof_" + randomUUID().slice(0, 8);
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

const PROV = randomUUID(), USER = randomUUID();

// Controllable audit mock: proves "exactly one success audit per finalize" via call count, and
// "audit failure rolls back the whole tx" via mockRejectedValueOnce. Audit runs INSIDE the finalize
// transaction, so a throw must abort the confirmation transition AND the Vehicle update together.
const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn(async (...a: unknown[]): Promise<void> => { void a; }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: async () => ({ barqUser: { id: USER }, provider: { id: PROV, status: "APPROVED" } }),
  ForbiddenError: class extends Error {},
  UnauthenticatedError: class extends Error {},
}));
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({ canViewRentalWorkspace: async () => true }));
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
// Hermetic storage: the cancel-convergence tests exercise the durable cleanup path, which attempts a
// real removePrivateObject after commit. Stub it so no network is touched; the real cleanup DOMAIN +
// real Postgres still run (the table is exercised by the dedicated cleanup dbproof).
vi.mock("@/lib/storage/storage", () => ({ removePrivateObject: async () => undefined, StorageNotConfiguredError: class extends Error {} }));

const { finalizeVehicleFromRegistration } = await import("./finalize-vehicle");
const { deleteDraftVehicle } = await import("./delete-draft-vehicle");

let admin: PrismaClient, db: PrismaClient;

const fullWith = (plate: string): Record<string, unknown> => ({
  make: "Toyota", model: "Prado", modelYear: "2019", color: "White",
  bookablePassengerCapacity: "13", licensedPassengerCapacity: "13", registeredSeats: "15",
  plateNumber: plate, vin: "JTEBU29J8K5012345", licenseExpiry: "31/05/2027", vehicleType: "SUV", declarationAccepted: "true",
});

type SeedOpts = { sha?: string; draftBoundSha?: string | null; submittedBoundSha?: string | null; otherPlate?: string | null };
async function seedShell(vehId: string, opts: SeedOpts = {}) {
  const docId = randomUUID(), extId = randomUUID();
  const sha = opts.sha ?? "sha-1";
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'REGISTERED'::"AssetStatus",'DRAFT'::"AssetVerificationStatus",now(),now())`, vehId, PROV);
    await tx.$executeRawUnsafe(`INSERT INTO "vehicles" ("assetId","registrationNumber","createdAt","updatedAt") VALUES ($1::uuid,$2,now(),now())`, vehId, opts.otherPlate ?? null);
    await tx.$executeRawUnsafe(`INSERT INTO "asset_documents" ("id","assetId","type","objectKey","originalFilename","mimeType","sizeBytes","status","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE_REGISTRATION',$3,'r.pdf','application/pdf',100,'PENDING'::"AssetDocumentStatus",now(),now())`, docId, vehId, `k/${vehId}.pdf`);
    await tx.$executeRawUnsafe(`INSERT INTO "vehicle_registration_extractions" ("id","assetId","assetDocumentId","documentSha256","parserVersion","source","status","fields","version","attemptCount","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'1.0.0','NATIVE_PDF_TEXT','EXTRACTED'::"VehicleRegistrationExtractionStatus",'{}'::jsonb,0,1,now(),now())`, extId, vehId, docId, sha);
    const boundSha = opts.submittedBoundSha ?? opts.draftBoundSha ?? null;
    if (boundSha !== null) {
      const status = opts.submittedBoundSha ? "SUBMITTED" : "DRAFT";
      await tx.$executeRawUnsafe(
        `INSERT INTO "vehicle_registration_confirmations" ("id","providerId","assetId","assetDocumentId","extractionId","boundDocumentSha256","boundParserVersion","status","declarationAccepted","version","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,'1.0.0',$7::"VehicleRegistrationConfirmationStatus",$8,0,now(),now())`,
        randomUUID(), PROV, vehId, docId, extId, boundSha, status, status === "SUBMITTED",
      );
    }
  });
  return { docId, extId };
}

const submittedCount = async (vehId: string) =>
  Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "vehicle_registration_confirmations" WHERE "assetId"=$1::uuid AND status='SUBMITTED'`, vehId)) as { n: number }[])[0]!.n);
const vehicleMake = async (vehId: string) =>
  ((await db.$queryRawUnsafe(`SELECT make FROM "vehicles" WHERE "assetId"=$1::uuid`, vehId)) as { make: string | null }[])[0]?.make ?? null;
const tableCount = async (table: string) =>
  Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "${table}"`)) as { n: number }[])[0]!.n);

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

beforeEach(() => {
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
});

const successAudits = () => auditMock.mock.calls.filter((c) => (c[0] as { action?: string } | undefined)?.action === "vehicle.created_from_registration").length;

describe.skipIf(!RUN)("finalizeVehicleFromRegistration — real Postgres", () => {
  it("fresh shell: two concurrent finalizes apply EXACTLY ONCE; the loser resolves safely (CONFLICT or idempotent replay), never a raw error or a second application", async () => {
    const veh = randomUUID();
    await seedShell(veh);
    const [a, b] = await Promise.all([finalizeVehicleFromRegistration(veh, fullWith("A 11111")), finalizeVehicleFromRegistration(veh, fullWith("A 11111"))]);
    const results = [a, b];
    // Reaching here at all means neither call threw a raw Prisma/SQL error (Promise.all would reject).
    // The authoritative application happened exactly once:
    expect(await submittedCount(veh)).toBe(1); // confirmation transitions once
    expect(await vehicleMake(veh)).toBe("Toyota"); // Vehicle applied once
    expect(successAudits()).toBe(1); // exactly one success audit committed
    // Exactly one call is the real creator (alreadyCreated:false); the other is a documented,
    // non-authoritative outcome — the idempotent replay (alreadyCreated:true) or CONFLICT.
    expect(results.filter((r) => r.ok && r.alreadyCreated === false).length).toBe(1);
    const loser = results.find((r) => !(r.ok && r.alreadyCreated === false))!;
    expect(loser.ok ? loser.alreadyCreated === true : loser.code === "CONFLICT").toBe(true);
  });

  it("active DRAFT: two concurrent finalizes — exactly one authoritative DRAFT→SUBMITTED transition (the other replays or conflicts)", async () => {
    const veh = randomUUID();
    await seedShell(veh, { draftBoundSha: "sha-1" });
    const [a, b] = await Promise.all([finalizeVehicleFromRegistration(veh, fullWith("A 22222")), finalizeVehicleFromRegistration(veh, fullWith("A 22222"))]);
    // The asset row lock now serializes finalizes, so the second normally re-reads the SUBMITTED
    // claim and replays idempotently; the version CAS remains as defense in depth (→ CONFLICT).
    expect([a, b].filter((r) => r.ok && r.alreadyCreated === false).length).toBe(1);
    const loser = [a, b].find((r) => !(r.ok && r.alreadyCreated === false))!;
    expect(loser.ok ? loser.alreadyCreated === true : loser.code === "CONFLICT").toBe(true);
    expect(await submittedCount(veh)).toBe(1);
    expect(await vehicleMake(veh)).toBe("Toyota");
    expect(successAudits()).toBe(1);
  });

  it("duplicate plate: the whole finalize tx rolls back (confirmation NOT submitted, Vehicle NOT applied)", async () => {
    const other = randomUUID();
    await seedShell(other, { otherPlate: "A 99999" }); // an existing vehicle already owns this plate
    const veh = randomUUID();
    await seedShell(veh);
    const res = await finalizeVehicleFromRegistration(veh, fullWith("A 99999"));
    expect(res).toEqual({ ok: false, code: "DUPLICATE_REGISTRATION" });
    expect(await submittedCount(veh)).toBe(0); // no confirmation transition
    expect(await vehicleMake(veh)).toBeNull(); // Vehicle untouched
    expect(successAudits()).toBe(0);
  });

  it("audit failure rolls back BOTH the confirmation transition and the Vehicle update", async () => {
    const veh = randomUUID();
    await seedShell(veh);
    auditMock.mockRejectedValueOnce(new Error("audit boom"));
    const res = await finalizeVehicleFromRegistration(veh, fullWith("A 55555"));
    expect(res).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(await submittedCount(veh)).toBe(0);
    expect(await vehicleMake(veh)).toBeNull();
  });

  it("document replaced since review (stale bound sha) → SUPERSEDED; no Vehicle write", async () => {
    const veh = randomUUID();
    // extraction now carries sha-2, but the active SUBMITTED claim is bound to sha-1 (replaced doc).
    await seedShell(veh, { sha: "sha-2", submittedBoundSha: "sha-1" });
    const res = await finalizeVehicleFromRegistration(veh, fullWith("A 66666"));
    expect(res).toEqual({ ok: false, code: "SUPERSEDED" });
    expect(await vehicleMake(veh)).toBeNull();
  });

  it("finalize then cancel converges: once finalized (SUBMITTED), cancel refuses (NOT_DELETABLE) — no half-deleted graph", async () => {
    const veh = randomUUID();
    await seedShell(veh);
    expect((await finalizeVehicleFromRegistration(veh, fullWith("A 77777"))).ok).toBe(true);
    const del = await deleteDraftVehicle(veh);
    expect(del).toEqual({ ok: false, code: "NOT_DELETABLE" });
    // The finalized vehicle graph is intact.
    expect(await submittedCount(veh)).toBe(1);
    expect(await vehicleMake(veh)).toBe("Toyota");
  });

  it("cancel then finalize converges: a cancelled shell is gone, finalize returns the non-enumerating not-found", async () => {
    const veh = randomUUID();
    await seedShell(veh);
    expect(await deleteDraftVehicle(veh)).toEqual({ ok: true });
    const res = await finalizeVehicleFromRegistration(veh, fullWith("A 88888"));
    expect(res).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    // The asset/vehicle/document/extraction graph is fully gone (no half-deleted rows).
    expect(Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "assets" WHERE id=$1::uuid`, veh)) as { n: number }[])[0]!.n)).toBe(0);
    expect(Number(((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM "vehicles" WHERE "assetId"=$1::uuid`, veh)) as { n: number }[])[0]!.n)).toBe(0);
  });

  it("finalize touches NO Booking / VehicleReservation / offering / service / pricing / vertical rows", async () => {
    const veh = randomUUID();
    await seedShell(veh);
    await finalizeVehicleFromRegistration(veh, fullWith("A 10101"));
    for (const table of ["bookings", "rental_vehicle_day_reservations", "rental_vehicle_day_hold_groups", "rental_offerings", "guided_tour_vehicle_offerings", "services", "prices", "provider_verticals"]) {
      expect(await tableCount(table)).toBe(0);
    }
  });
});
