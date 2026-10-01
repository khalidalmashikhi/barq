import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Phase 3C Slice 2 (correction) — REAL concurrency proof against a disposable PostgreSQL with TWO
// clients, running the ACTUAL runVehicleRegistrationExtraction (real unique-index + version-CAS +
// P2002 handling + transactional audit). Only the PDF adapter + storage download are injected
// (their own suites cover them). Gated behind EXTRACTION_DBPROOF=1 so the default suite never
// touches a database:
//   EXTRACTION_DBPROOF=1 npx vitest run src/lib/vehicles/registration-extraction/extract-registration.dbproof.test.ts
const RUN = process.env.EXTRACTION_DBPROOF === "1";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { runVehicleRegistrationExtraction } = await import("./extract-registration-service");

const PROJECT = process.cwd();
const dbName = "barq_extract_dbproof_" + randomUUID().slice(0, 8);
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

let db: PrismaClient, db2: PrismaClient, admin: PrismaClient, throwawayUrl: string;
const PROV = randomUUID(), VEH = randomUUID(), DOC = randomUUID();
const BYTES = new TextEncoder().encode("concurrency-proof-bytes").buffer;
const REG_TEXT = ["رقم اللوحة: A 12345", "نوع المركبة: Toyota", "الموديل: Prado", "عدد الركاب: 7", "سنة الصنع: 2019", "رقم الهيكل: JTEBU29J8K5012345", "تاريخ الانتهاء: 31/05/2027"].join("\n");

const okDeps = (client: PrismaClient) => ({ db: client, isStorageConfigured: () => true, downloadPrivateObject: async () => BYTES, extractPdfText: async () => ({ ok: true as const, pageCount: 1, text: REG_TEXT }) });
const failDeps = (client: PrismaClient) => ({ ...okDeps(client), extractPdfText: async () => ({ ok: false as const, code: "PARSER_TIMEOUT" as const }) });

async function seedDoc(client: PrismaClient) {
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, PROV, randomUUID());
    await tx.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'REGISTERED'::"AssetStatus",'DRAFT'::"AssetVerificationStatus",now(),now())`, VEH, PROV);
    await tx.$executeRawUnsafe(`INSERT INTO "asset_documents" ("id","assetId","type","objectKey","originalFilename","mimeType","sizeBytes","status","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE_REGISTRATION','k/reg.pdf','reg.pdf','application/pdf',100,'PENDING'::"AssetDocumentStatus",now(),now())`, DOC, VEH);
  });
}
const clearExtractions = () => db.$executeRawUnsafe(`DELETE FROM "vehicle_registration_extractions"`);
const clearAudit = () => db.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE action='vehicle.registration_extracted'`);
const rowCount = async () => Number(((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "vehicle_registration_extractions"`)) as { n: number }[])[0]!.n);
const auditCount = async () => Number(((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "audit_logs" WHERE action='vehicle.registration_extracted'`)) as { n: number }[])[0]!.n);
const theRow = async () => ((await db.$queryRawUnsafe(`SELECT status, "attemptCount" AS a, version FROM "vehicle_registration_extractions" LIMIT 1`)) as { status: string; a: number; version: number }[])[0];

beforeAll(async () => {
  if (!RUN) return;
  const u = urls(); throwawayUrl = u.throwaway;
  admin = new PrismaClient({ datasources: { db: { url: u.admin } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: PROJECT, stdio: "ignore", env: { ...process.env, DATABASE_URL: throwawayUrl, DIRECT_URL: throwawayUrl } });
  db = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  db2 = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  await seedDoc(db);
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db?.$disconnect(); await db2?.$disconnect();
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.$disconnect();
});

describe.skipIf(!RUN)("runVehicleRegistrationExtraction — real-DB concurrency", () => {
  it("two concurrent extractions of the same document → ONE row, ONE success audit, no raw P2002", async () => {
    await clearExtractions(); await clearAudit();
    const [r1, r2] = await Promise.all([runVehicleRegistrationExtraction({ assetDocumentId: DOC }, okDeps(db)), runVehicleRegistrationExtraction({ assetDocumentId: DOC }, okDeps(db2))]);
    expect(r1.ok).toBe(true); expect(r2.ok).toBe(true);
    expect(await rowCount()).toBe(1);
    expect(await auditCount()).toBe(1); // exactly one success audit despite two workers
    expect((await theRow())!.status).toBe("EXTRACTED");
  });

  it("a concurrent transient FAILURE never overwrites the concurrent SUCCESS", async () => {
    await clearExtractions(); await clearAudit();
    const [r1, r2] = await Promise.all([runVehicleRegistrationExtraction({ assetDocumentId: DOC }, okDeps(db)), runVehicleRegistrationExtraction({ assetDocumentId: DOC }, failDeps(db2))]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(await rowCount()).toBe(1);
    expect((await theRow())!.status).toBe("EXTRACTED"); // deterministic: success wins regardless of order
  });

  it("a FAILED row is RETRYABLE and not stuck — a later success updates it with attemptCount++", async () => {
    await clearExtractions(); await clearAudit();
    // First run FAILS (parser timeout) → FAILED row, attemptCount 1.
    const f = await runVehicleRegistrationExtraction({ assetDocumentId: DOC }, failDeps(db));
    expect(f.ok).toBe(true);
    expect((await theRow())!.status).toBe("FAILED");
    // Second run SUCCEEDS → same row flips to EXTRACTED, attemptCount 2.
    const s = await runVehicleRegistrationExtraction({ assetDocumentId: DOC }, okDeps(db));
    expect(s.ok).toBe(true);
    const row = (await theRow())!;
    expect(row.status).toBe("EXTRACTED");
    expect(row.a).toBe(2);
  });

  it("re-running an EXTRACTED document (same bytes) is an idempotent no-op — no new audit", async () => {
    await clearExtractions(); await clearAudit();
    await runVehicleRegistrationExtraction({ assetDocumentId: DOC }, okDeps(db));
    const auditAfterFirst = await auditCount();
    const again = await runVehicleRegistrationExtraction({ assetDocumentId: DOC }, okDeps(db));
    expect(again).toMatchObject({ ok: true, idempotent: true, status: "EXTRACTED" });
    expect(await auditCount()).toBe(auditAfterFirst); // no duplicate audit
    expect(await rowCount()).toBe(1);
  });
});
