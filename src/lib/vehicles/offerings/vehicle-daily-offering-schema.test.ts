import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";

// Phase 3C Slice C1 — schema/migration-focused tests for the INERT vehicle-based daily-offering
// foundations. C1 adds NO application behavior, so these assert the schema shape (via the Prisma
// DMMF) and the migration's structural guarantees (via the raw SQL). The DB-enforced behaviors
// (partial-unique, CHECK ranges, serviceDate round-trip) are proven separately on a disposable
// PostgreSQL rehearsal; here we lock the no-shift date CONVENTION and the SQL that backs them.

const models = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const enums = Object.fromEntries(Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]));
const field = (model: string, name: string) => models[model]?.fields.find((f) => f.name === name);

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20260915120000_vehicle_daily_offering_foundations/migration.sql"),
  "utf8",
);

describe("Slice C1 — the six offering models exist with the correct mappings", () => {
  it("maps all six new tables", () => {
    const expected: Record<string, string> = {
      RentalOffering: "rental_offerings",
      RentalOfferingDay: "rental_offering_days",
      RentalStartTime: "rental_start_times",
      GuidedTourVehicleOffering: "guided_tour_vehicle_offerings",
      GuidedTourVehicleOfferingDay: "guided_tour_vehicle_offering_days",
      GuidedTourVehicleStartTime: "guided_tour_vehicle_start_times",
    };
    for (const [model, table] of Object.entries(expected)) {
      expect(models[model], `${model} exists`).toBeTruthy();
      expect(models[model]!.dbName ?? models[model]!.name).toBe(table);
    }
  });

  it("declares the four new enums (two vertical-specific status enums + two shared low-level enums)", () => {
    expect(enums.RentalOfferingStatus).toEqual(["DRAFT", "PUBLISHED", "SUSPENDED", "ARCHIVED"]);
    expect(enums.GuidedTourVehicleOfferingStatus).toEqual(["DRAFT", "PUBLISHED", "SUSPENDED", "ARCHIVED"]);
    expect(enums.OfferingDayState).toEqual(["OPEN", "BLOCKED"]);
    expect(enums.StartTimeState).toEqual(["OPEN", "CLOSED"]);
  });
});

describe("Slice C1 — offering field shape + locked decisions", () => {
  it.each(["RentalOffering", "GuidedTourVehicleOffering"])("%s: money/currency/capacity/status shape", (m) => {
    expect(field(m, "baseDailyAmount")?.type).toBe("Decimal");
    // Currency lives on the OFFERING (required), never on the day.
    const currency = field(m, "currency");
    expect(currency?.type).toBe("String");
    expect(currency?.isRequired).toBe(true);
    // Optional stricter capacity override, nullable Int (cross-table bound enforced in C2b).
    const cap = field(m, "offeringCapacityOverride");
    expect(cap?.type).toBe("Int");
    expect(cap?.isRequired).toBe(false);
    // Fail-closed publication default.
    expect(field(m, "status")?.default).toBe("DRAFT");
  });

  it.each(["RentalOfferingDay", "GuidedTourVehicleOfferingDay"])("%s: DateTime service date + BLOCKED default + no currency", (m) => {
    // serviceDate is a DateTime Prisma field mapped to a PostgreSQL `date` (@db.Date) — the
    // zone-free native type is asserted against the migration SQL below (DMMF TS types don't
    // surface nativeType).
    expect(field(m, "serviceDate")?.type).toBe("DateTime");
    // Fail-closed day default: a day is not available unless explicitly OPENed.
    expect(field(m, "state")?.default).toBe("BLOCKED");
    // Day override is nullable and carries NO currency (uses the offering currency).
    expect(field(m, "dailyAmountOverride")?.isRequired).toBe(false);
    expect(field(m, "currency")).toBeUndefined();
  });

  it.each(["RentalStartTime", "GuidedTourVehicleStartTime"])("start time is Oman-local minutes, defaults OPEN", (m) => {
    expect(field(m, "startTimeMinutes")?.type).toBe("Int");
    expect(field(m, "state")?.default).toBe("OPEN");
  });

  it("guided-tour offering deliberately has NO guideId (guide assignment stays booking-level)", () => {
    expect(field("GuidedTourVehicleOffering", "guideId")).toBeUndefined();
    expect(models.GuidedTourVehicleOffering!.fields.some((f) => f.name.toLowerCase().includes("guide"))).toBe(false);
  });
});

describe("Slice C1 — the migration is additive/inert and backs the fail-closed constraints", () => {
  it("touches NO existing table (no ALTER of services/vehicles/prices/bookings/vehicle_reservations)", () => {
    for (const t of ["services", "vehicles", "prices", "bookings", "vehicle_reservations", "availabilities"]) {
      expect(MIGRATION_SQL).not.toMatch(new RegExp(`ALTER TABLE "${t}"`));
    }
  });

  it("contains no destructive or data operation", () => {
    // Guard the executable DDL only — comments describe the negatives. Strip comment lines first.
    const sql = MIGRATION_SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i); // a data UPDATE targets a quoted table; "ON UPDATE CASCADE" does not
    expect(sql).not.toMatch(/DELETE\s+FROM/i); // a data DELETE; "ON DELETE RESTRICT" does not match
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/SET NOT NULL/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/PER_DAY|PER_VEHICLE_DAY/); // no pricing-unit-registry change
  });

  it("declares both partial unique indexes (one active offering per (serviceId, vehicleId), archived exempt)", () => {
    for (const t of ["rental_offerings", "guided_tour_vehicle_offerings"]) {
      const re = new RegExp(`CREATE UNIQUE INDEX[\\s\\S]*?ON "${t}" \\("serviceId", "vehicleId"\\)[\\s\\S]*?WHERE "status" <> 'ARCHIVED'`);
      expect(MIGRATION_SQL).toMatch(re);
    }
  });

  it("declares the row-local CHECK constraints (positive money, positive overrides, minute range)", () => {
    expect(MIGRATION_SQL).toMatch(/CHECK \("baseDailyAmount" > 0\)/);
    expect(MIGRATION_SQL).toMatch(/CHECK \("offeringCapacityOverride" IS NULL OR "offeringCapacityOverride" > 0\)/);
    expect(MIGRATION_SQL).toMatch(/CHECK \("dailyAmountOverride" IS NULL OR "dailyAmountOverride" > 0\)/);
    expect(MIGRATION_SQL).toMatch(/CHECK \("startTimeMinutes" BETWEEN 0 AND 1439\)/);
  });

  it("serviceDate is a PostgreSQL DATE column (@db.Date, zone-free) in both day tables", () => {
    const dateCols = MIGRATION_SQL.match(/"serviceDate" DATE NOT NULL/g) ?? [];
    expect(dateCols.length).toBe(2);
  });

  it("all new foreign keys are ON DELETE RESTRICT (history is never lost via parent deletion)", () => {
    const fks = MIGRATION_SQL.match(/ADD CONSTRAINT[^;]*FOREIGN KEY[^;]*;/g) ?? [];
    expect(fks.length).toBe(8);
    for (const fk of fks) expect(fk).toMatch(/ON DELETE RESTRICT/);
  });
});

describe("Slice C1 — Oman serviceDate representation cannot shift the calendar date", () => {
  it("a UTC-midnight calendar date round-trips its YYYY-MM-DD unchanged", () => {
    // The stored/read convention: a pure calendar date is written/read at UTC-midnight, so no
    // timezone offset is ever applied and the YYYY-MM-DD is invariant to the server timezone.
    for (const ymd of ["2026-08-20", "2026-01-01", "2026-12-31"]) {
      const stored = new Date(`${ymd}T00:00:00.000Z`);
      expect(stored.toISOString().slice(0, 10)).toBe(ymd);
    }
  });
});
