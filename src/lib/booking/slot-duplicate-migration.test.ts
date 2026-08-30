import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// SLOT BUSINESS-DUPLICATE ATOMICITY — §18: a mocked test cannot exercise a real Postgres partial
// unique index across two connections, so the DB GUARANTEE is pinned here by asserting the
// committed migration SQL. The application branches (pre-tx guard, P2002→DUPLICATE_BOOKING
// discrimination) are unit-tested in create-booking.test.ts; this proves the durable invariant
// those branches back onto exists and is scoped EXACTLY to the current rule.
const SQL = readFileSync("prisma/migrations/20260901120000_slot_active_booking_unique/migration.sql", "utf8");
const STATEMENTS = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("bookings_active_slot_per_customer_key migration — the one-active-booking-per-slot invariant", () => {
  it("creates a UNIQUE index on (customerId, availabilityId)", () => {
    expect(STATEMENTS).toMatch(
      /CREATE UNIQUE INDEX\s+"bookings_active_slot_per_customer_key"\s+ON\s+"bookings"\s*\(\s*"customerId"\s*,\s*"availabilityId"\s*\)/s
    );
  });

  it("is PARTIAL — excludes slotless (NULL availabilityId) and CANCELLED, matching the current rule exactly", () => {
    expect(STATEMENTS).toMatch(/WHERE\s+"availabilityId"\s+IS\s+NOT\s+NULL\s+AND\s+"status"\s*<>\s*'CANCELLED'/is);
  });

  it("does NOT scope by priceId or serviceId (a price change can't bypass the rule; the slot is authoritative)", () => {
    // The index column list is (customerId, availabilityId) only.
    expect(STATEMENTS).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*"priceId"/);
    expect(STATEMENTS).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*"serviceId"/);
  });

  it("does NOT hand-pick an active-status list — it uses the exact status <> CANCELLED predicate", () => {
    // Guard against a future edit that silently narrows the rule to e.g. only PENDING/CONFIRMED.
    for (const s of ["PENDING_PROVIDER", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "REJECTED", "EXPIRED", "DISPUTED"]) {
      expect(STATEMENTS).not.toContain(s);
    }
  });

  it("is ADDITIVE ONLY — one CREATE UNIQUE INDEX; no DROP/ALTER/DELETE/UPDATE, no backfill", () => {
    expect(STATEMENTS).not.toMatch(/\bDROP\b/i);
    expect(STATEMENTS).not.toMatch(/\bALTER\b/i);
    expect(STATEMENTS).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(STATEMENTS).not.toMatch(/\bUPDATE\s+"/i);
    expect(STATEMENTS).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect((STATEMENTS.match(/CREATE UNIQUE INDEX/g) ?? []).length).toBe(1);
  });
});
