import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Phase 3C Slice 3A — REAL-Postgres proof of the confirmation write: the partial-unique index
// (one ACTIVE claim per document), SUBMIT → LOCKED, and the document-replacement SUPERSESSION path.
// Gated behind REGISTRATION_DBPROOF=1 so the default suite never touches a database:
//   REGISTRATION_DBPROOF=1 npx vitest run src/lib/vehicles/registration-review/write-confirmation.dbproof.test.ts
const RUN = process.env.REGISTRATION_DBPROOF === "1";

const PROJECT = process.cwd();
const dbName = "barq_regconf_dbproof_" + randomUUID().slice(0, 8);
function urls() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path.join(PROJECT, ".env"), "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m && m[1]) env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, ""); }
  const base = env.DATABASE_URL ?? "";
  const a = new URL(base); a.pathname = "/postgres";
  const t = new URL(base); t.pathname = "/" + dbName;
  return { admin: a.toString(), throwaway: t.toString() };
}
const throwawayUrl = RUN ? urls().throwaway : "";
// Bind the global prisma (imported by the domain fn) to the disposable DB BEFORE importing it.
if (RUN) { process.env.DATABASE_URL = throwawayUrl; process.env.DIRECT_URL = throwawayUrl; }

const PROV = randomUUID(), VEH = randomUUID(), DOC = randomUUID(), EXT = randomUUID(), USER = randomUUID();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: async () => ({ barqUser: { id: USER }, provider: { id: PROV } }) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { writeRegistrationConfirmation } = await import("./write-confirmation");

let admin: PrismaClient, db: PrismaClient;
const FULL: Record<string, unknown> = { make: "Toyota", model: "Prado", modelYear: "2019", bookablePassengerCapacity: "13", licensedPassengerCapacity: "13", registeredSeats: "15", plateNumber: "A 12345", vin: "JTEBU29J8K5012345", licenseExpiry: "31/05/2027", declarationAccepted: "true" };

async function seed(sha: string) {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, PROV, randomUUID());
    await tx.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'REGISTERED'::"AssetStatus",'DRAFT'::"AssetVerificationStatus",now(),now())`, VEH, PROV);
    await tx.$executeRawUnsafe(`INSERT INTO "asset_documents" ("id","assetId","type","objectKey","originalFilename","mimeType","sizeBytes","status","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE_REGISTRATION','k/r.pdf','r.pdf','application/pdf',100,'PENDING'::"AssetDocumentStatus",now(),now())`, DOC, VEH);
    await tx.$executeRawUnsafe(`INSERT INTO "vehicle_registration_extractions" ("id","assetId","assetDocumentId","documentSha256","parserVersion","source","status","fields","version","attemptCount","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'1.0.0','NATIVE_PDF_TEXT','EXTRACTED'::"VehicleRegistrationExtractionStatus",'{}'::jsonb,0,1,now(),now())`, EXT, VEH, DOC, sha);
  });
}
const activeCount = async () => Number(((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "vehicle_registration_confirmations" WHERE status <> 'SUPERSEDED'`)) as { n: number }[])[0]!.n);
const supersededCount = async () => Number(((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "vehicle_registration_confirmations" WHERE status = 'SUPERSEDED'`)) as { n: number }[])[0]!.n);

beforeAll(async () => {
  if (!RUN) return;
  admin = new PrismaClient({ datasources: { db: { url: urls().admin } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: PROJECT, stdio: "ignore", env: { ...process.env, DATABASE_URL: throwawayUrl, DIRECT_URL: throwawayUrl } });
  db = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  await seed("sha-1");
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.$disconnect();
});

describe.skipIf(!RUN)("writeRegistrationConfirmation — real Postgres", () => {
  it("SUBMIT creates exactly one active claim; re-submitting the same is LOCKED", async () => {
    const r1 = await writeRegistrationConfirmation("SUBMIT", VEH, FULL);
    expect(r1).toEqual({ ok: true });
    expect(await activeCount()).toBe(1);
    const r2 = await writeRegistrationConfirmation("SUBMIT", VEH, FULL);
    expect(r2).toEqual({ ok: false, code: "LOCKED" });
    expect(await activeCount()).toBe(1);
  });

  it("the partial-unique index rejects a second ACTIVE claim for the same document", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "vehicle_registration_confirmations" ("id","providerId","assetId","assetDocumentId","extractionId","boundDocumentSha256","boundParserVersion","status","declarationAccepted","version","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'sha-1','1.0.0','DRAFT'::"VehicleRegistrationConfirmationStatus",false,0,now(),now())`,
        randomUUID(), PROV, VEH, DOC, EXT,
      ),
    ).rejects.toThrow();
  });

  it("replacing the document SUPERSEDES the old submitted claim and creates a fresh active one", async () => {
    // Simulate a replaced document: the extraction now carries a new hash.
    await db.$executeRawUnsafe(`UPDATE "vehicle_registration_extractions" SET "documentSha256" = 'sha-2' WHERE id = $1::uuid`, EXT);
    const r = await writeRegistrationConfirmation("SUBMIT", VEH, FULL);
    expect(r).toEqual({ ok: true });
    expect(await activeCount()).toBe(1); // the new claim
    expect(await supersededCount()).toBe(1); // the old one retained as history
  });
});
