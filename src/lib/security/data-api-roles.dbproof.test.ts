import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// 2026-10-21 — Security incident follow-up: Supabase's Data-API roles (`anon`, `authenticated`) held
// full CRUD on every table in `public`. This proof runs ONLY against a disposable PostgreSQL 17
// (DATA_API_DBPROOF=1 + DATA_API_DBPROOF_ADMIN_URL = a local superuser URL) and:
//   1. reproduces Supabase's roles + dangerous default grants (scripts/engineering/supabase-roles-sim.sql),
//   2. migrates to 66 and PROVES the exposure is detected (negative control),
//   3. applies migration 67 on top, and separately migrates 1–67 from zero,
//   4. proves anon / authenticated have no effective privilege (direct, inherited or via PUBLIC),
//      new tables / sequences stay closed, a new function is closed by the REVOKE the migration rule
//      requires, global defaults are untouched, service_role is untouched and Prisma still reads + writes.

const RUN = process.env.DATA_API_DBPROOF === "1";
const ADMIN_URL = process.env.DATA_API_DBPROOF_ADMIN_URL ?? "";
const ROOT = process.cwd();
const PRISMA_CLI = path.join(ROOT, "node_modules/prisma/build/index.js");
const SECURITY_MIGRATION = "20261021120000_revoke_data_api_role_privileges";
const ROLES = ["anon", "authenticated"] as const;

function dbUrl(user: string, password: string | null, db: string): string {
  const u = new URL(ADMIN_URL);
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("DATA_API_DBPROOF_ADMIN_URL must point at a LOCAL disposable server");
  u.username = user;
  if (password !== null) u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

/** Split a SQL script into statements, keeping $$-quoted DO blocks intact. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inDollar = false;
  for (const line of sql.replace(/--.*$/gm, "").split("\n")) {
    cur += line + "\n";
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function runScript(client: PrismaClient, file: string) {
  for (const s of statements(readFileSync(file, "utf8"))) await client.$executeRawUnsafe(s);
}

function migrate(schemaPath: string, url: string) {
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy", "--schema", schemaPath], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
  });
}

type Exposure = { tables: number; tablesExposed: number; sequences: number; sequencesExposed: number; routinesExposed: number; canCreate: boolean };
async function exposure(su: PrismaClient, role: string): Promise<Exposure> {
  const [r] = await su.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) AS tables,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
          AND has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS tables_exposed,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S') AS sequences,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S'
          AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege($1, c.oid, 'USAGE,SELECT,UPDATE') ELSE false END) AS sequences_exposed,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
          AND has_function_privilege($1, p.oid, 'EXECUTE')) AS routines_exposed,
       has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
    role,
  );
  return {
    tables: Number(r!.tables),
    tablesExposed: Number(r!.tables_exposed),
    sequences: Number(r!.sequences),
    sequencesExposed: Number(r!.sequences_exposed),
    routinesExposed: Number(r!.routines_exposed),
    canCreate: Boolean(r!.can_create),
  };
}

async function serviceRolePrivileges(su: PrismaClient): Promise<string> {
  const rows = await su.$queryRawUnsafe<{ obj: string; privs: string }[]>(
    `SELECT c.relname AS obj,
            concat_ws(',', CASE WHEN has_table_privilege('service_role', c.oid, 'SELECT') THEN 'S' END,
                           CASE WHEN has_table_privilege('service_role', c.oid, 'INSERT') THEN 'I' END,
                           CASE WHEN has_table_privilege('service_role', c.oid, 'UPDATE') THEN 'U' END,
                           CASE WHEN has_table_privilege('service_role', c.oid, 'DELETE') THEN 'D' END) AS privs
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1`,
  );
  return JSON.stringify(rows);
}

const UPGRADE_DB = `barq_dataapi_upgrade_${randomUUID().slice(0, 8)}`;
const FRESH_DB = `barq_dataapi_fresh_${randomUUID().slice(0, 8)}`;
let admin: PrismaClient;
const opened: PrismaClient[] = [];
const client = (url: string) => {
  const c = new PrismaClient({ datasources: { db: { url } } });
  opened.push(c);
  return c;
};
let tmp = "";
const result: Record<string, unknown> = {};

beforeAll(async () => {
  if (!RUN) return;
  admin = client(dbUrl(new URL(ADMIN_URL).username, null, "postgres"));
  for (const db of [UPGRADE_DB, FRESH_DB]) await admin.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
  for (const db of [UPGRADE_DB, FRESH_DB]) await runScript(client(dbUrl(new URL(ADMIN_URL).username, null, db)), path.join(ROOT, "scripts/engineering/supabase-roles-sim.sql"));

  // UPGRADE path: migrations 1–66 only (a schema copy without the security migration)
  tmp = mkdtempSync(path.join(tmpdir(), "barq-dataapi-"));
  cpSync(path.join(ROOT, "prisma"), path.join(tmp, "prisma"), { recursive: true });
  rmSync(path.join(tmp, "prisma/migrations", SECURITY_MIGRATION), { recursive: true, force: true });
  const appUpgrade = dbUrl("postgres", "dbproof", UPGRADE_DB);
  migrate(path.join(tmp, "prisma/schema.prisma"), appUpgrade);

  const suUpgrade = client(dbUrl(new URL(ADMIN_URL).username, null, UPGRADE_DB));
  // a function that already exists before the fix (e.g. created from a dashboard) — EXECUTE via PUBLIC
  await client(appUpgrade).$executeRawUnsafe(`CREATE FUNCTION public.__dbproof_preexisting() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
  result.before = { anon: await exposure(suUpgrade, "anon"), authenticated: await exposure(suUpgrade, "authenticated") };
  result.serviceBefore = await serviceRolePrivileges(suUpgrade);

  // then 67 on top of 66, and 1–67 from zero
  migrate(path.join(ROOT, "prisma/schema.prisma"), appUpgrade);
  migrate(path.join(ROOT, "prisma/schema.prisma"), dbUrl("postgres", "dbproof", FRESH_DB));
}, 600_000);

afterAll(async () => {
  if (!RUN) return;
  for (const c of opened.splice(1)) await c.$disconnect().catch(() => {});
  for (const db of [UPGRADE_DB, FRESH_DB]) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => {});
  await admin.$disconnect();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!RUN)("Supabase Data-API roles — exposure before, closed after migration 67 (disposable PostgreSQL 17)", () => {
  it("NEGATIVE CONTROL: at migration 66 the proof detects the exposure (all tables, sequences, routines, CREATE)", () => {
    for (const role of ROLES) {
      const b = (result.before as Record<string, Exposure>)[role]!;
      expect(b.tables).toBeGreaterThan(60);
      expect(b.tablesExposed, role).toBe(b.tables);
      expect(b.sequences).toBe(2);
      expect(b.sequencesExposed, role).toBe(2);
      expect(b.routinesExposed, role).toBe(1);
      expect(b.canCreate, role).toBe(true);
    }
  });

  it.each([
    ["upgrade 66 → 67", () => UPGRADE_DB],
    ["from zero 1 → 67", () => FRESH_DB],
  ])("%s: anon and authenticated have no effective table / sequence / routine privilege and no CREATE", async (_label, db) => {
    const su = client(dbUrl(new URL(ADMIN_URL).username, null, db()));
    for (const role of ROLES) expect(await exposure(su, role), role).toMatchObject({ tablesExposed: 0, sequencesExposed: 0, routinesExposed: 0, canCreate: false });
    const [m] = await su.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    expect(Number(m!.n)).toBe(readdirSync(path.join(ROOT, "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).length);
  });

  it("objects created AFTER the migration: tables / sequences stay closed; a new function is closed by the REVOKE the migration rule requires", async () => {
    const app = client(dbUrl("postgres", "dbproof", FRESH_DB));
    await app.$executeRawUnsafe(`CREATE TABLE public.__dbproof_new (id int)`);
    await app.$executeRawUnsafe(`CREATE SEQUENCE public.__dbproof_new_seq`);
    await app.$executeRawUnsafe(`CREATE FUNCTION public.__dbproof_new_fn() RETURNS int LANGUAGE sql AS 'SELECT 2'`);
    const su = client(dbUrl(new URL(ADMIN_URL).username, null, FRESH_DB));
    await su.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dbproof_nobody') THEN CREATE ROLE dbproof_nobody NOLOGIN; END IF; END $$`);
    const check = async (role: string) => {
      const [r] = await su.$queryRawUnsafe<{ t: boolean; s: boolean; f: boolean }[]>(
        `SELECT has_table_privilege($1, 'public.__dbproof_new', 'SELECT,INSERT,UPDATE,DELETE') AS t,
                has_sequence_privilege($1, 'public.__dbproof_new_seq', 'USAGE,SELECT,UPDATE') AS s,
                has_function_privilege($1, 'public.__dbproof_new_fn()', 'EXECUTE') AS f`,
        role,
      );
      return r!;
    };
    // tables / sequences: closed for the API roles AND for a role with no memberships (PUBLIC holds nothing)
    // functions: PostgreSQL's GLOBAL built-in default still grants EXECUTE to PUBLIC (deliberately not
    // changed — it would also affect platform schemas); the per-schema anon / authenticated defaults are gone
    for (const role of [...ROLES, "dbproof_nobody"]) expect(await check(role), role).toEqual({ t: false, s: false, f: true });
    // exactly what scripts/engineering/check-migrations.mjs requires of any migration that creates a routine in public
    await app.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION public.__dbproof_new_fn() FROM PUBLIC, anon, authenticated`);
    for (const role of [...ROLES, "dbproof_nobody"]) expect(await check(role), role).toEqual({ t: false, s: false, f: false });
    await app.$executeRawUnsafe(`DROP FUNCTION public.__dbproof_new_fn()`);
    await app.$executeRawUnsafe(`DROP SEQUENCE public.__dbproof_new_seq`);
    await app.$executeRawUnsafe(`DROP TABLE public.__dbproof_new`);
  });

  it("the migration leaves GLOBAL default privileges alone (extensions / platform schemas unaffected)", async () => {
    for (const db of [UPGRADE_DB, FRESH_DB]) {
      const su = client(dbUrl(new URL(ADMIN_URL).username, null, db));
      const [r] = await su.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_default_acl WHERE defaclnamespace = 0`);
      expect(Number(r!.n), db).toBe(0);
    }
  });

  it("service_role is untouched by the migration (Storage path unchanged)", async () => {
    const su = client(dbUrl(new URL(ADMIN_URL).username, null, UPGRADE_DB));
    expect(await serviceRolePrivileges(su)).toBe(result.serviceBefore);
  });

  it("Prisma (the app role) still reads and writes, and the app's sequences still work", async () => {
    const app = client(dbUrl("postgres", "dbproof", UPGRADE_DB));
    const key = `dbproof-${randomUUID()}`;
    const created = await app.featureFlag.create({ data: { key, enabled: true } });
    expect((await app.featureFlag.findUnique({ where: { key } }))?.id).toBe(created.id);
    await app.featureFlag.update({ where: { key }, data: { enabled: false } });
    await app.featureFlag.delete({ where: { key } });
    const [seq] = await app.$queryRawUnsafe<{ value: bigint }[]>(`SELECT nextval('booking_contract_number_seq') AS value`);
    expect(Number(seq!.value)).toBeGreaterThan(0);
  });

  it("the migration is idempotent: re-running it changes nothing and raises nothing", async () => {
    const app = client(dbUrl("postgres", "dbproof", UPGRADE_DB));
    await runScript(app, path.join(ROOT, "prisma/migrations", SECURITY_MIGRATION, "migration.sql"));
    const su = client(dbUrl(new URL(ADMIN_URL).username, null, UPGRADE_DB));
    for (const role of ROLES) expect(await exposure(su, role), role).toMatchObject({ tablesExposed: 0, sequencesExposed: 0, routinesExposed: 0, canCreate: false });
  });
});
