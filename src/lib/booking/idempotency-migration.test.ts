import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// BOOKING-IDEMPOTENCY — §25: a mocked Promise.all cannot exercise a real Postgres unique index, so
// the race-arbitration GUARANTEE is pinned here by asserting the committed migration SQL. The
// application-level branches (replay / conflict / P2002 handling) are unit-tested in
// create-booking.test.ts; this proves the durable constraint those branches depend on actually
// exists and is scoped correctly. (See the report's §25 for the honest limitation on true DB
// concurrency testing in this environment.)
const SQL = readFileSync("prisma/migrations/20260831120000_booking_idempotency/migration.sql", "utf8");
// The additive-only assertions inspect executable SQL, not the `-- comment` prose (which
// deliberately says "No DROP, no DELETE, ..."). Strip comment lines first.
const STATEMENTS = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("booking_idempotency_keys migration — the durable race arbiter", () => {
  it("creates the booking_idempotency_keys table", () => {
    expect(SQL).toContain('CREATE TABLE "booking_idempotency_keys"');
    expect(SQL).toContain('"customerId" UUID NOT NULL');
    expect(SQL).toContain('"idempotencyKey" TEXT NOT NULL');
    expect(SQL).toContain('"requestFingerprint" TEXT NOT NULL');
    expect(SQL).toContain('"bookingId" UUID NOT NULL');
  });

  it("THE RACE ARBITER — a per-customer UNIQUE on (customerId, idempotencyKey)", () => {
    expect(SQL).toContain(
      'CREATE UNIQUE INDEX "booking_idempotency_keys_customerId_idempotencyKey_key" ON "booking_idempotency_keys"("customerId", "idempotencyKey")'
    );
  });

  it("is one-claim-per-booking (UNIQUE bookingId)", () => {
    expect(SQL).toContain('CREATE UNIQUE INDEX "booking_idempotency_keys_bookingId_key" ON "booking_idempotency_keys"("bookingId")');
  });

  it("scopes ownership to customers and binds to a real booking (both RESTRICT — never orphaned)", () => {
    expect(SQL).toMatch(/booking_idempotency_keys_customerId_fkey.*REFERENCES "customers"\("id"\) ON DELETE RESTRICT/s);
    expect(SQL).toMatch(/booking_idempotency_keys_bookingId_fkey.*REFERENCES "bookings"\("id"\) ON DELETE RESTRICT/s);
  });

  it("is ADDITIVE ONLY — no DROP/ALTER/DELETE/UPDATE of any existing object, no backfill", () => {
    expect(STATEMENTS).not.toMatch(/\bDROP\b/i);
    // Our own FK ALTERs target booking_idempotency_keys; nothing touches an existing table.
    expect(STATEMENTS).not.toMatch(/ALTER TABLE "(bookings|customers|availabilities|prices)"/i);
    expect(STATEMENTS).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(STATEMENTS).not.toMatch(/\bUPDATE\s+"/i);
    expect(STATEMENTS).not.toMatch(/\bINSERT\s+INTO\b/i); // no backfill
  });
});
