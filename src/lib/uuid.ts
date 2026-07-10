import "server-only";

// UUID validation — Engineering Sprint (Booking Engine).
//
// Every BARQ-owned entity ID (User, Service, Booking, Price, etc.) is
// UUID v7, per ADR-0006 — a plain regex format check, not a version-7
// specific one (Prisma/Postgres's @db.Uuid column only cares about
// valid UUID syntax generally, not the version nibble specifically).
//
// This exists because passing a non-UUID string into a query against a
// @db.Uuid column throws a Prisma runtime error (the same class of bug
// already found and fixed once for Better Auth's non-UUID IDs against
// a UUID-typed column, DEVELOPMENT_LOG.md Entry 046) — checking the
// format before the query avoids a crash for something as ordinary as
// a mistyped or manipulated URL segment, converting it into a clean
// 404 instead.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
