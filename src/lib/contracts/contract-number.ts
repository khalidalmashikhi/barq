import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Contract Number generation — Phase E.2, requirement #3.
//
// Backed by the `booking_contract_number_seq` Postgres sequence
// (created via raw SQL in this phase's migration — Prisma's schema DSL
// only supports autoincrement() on an Int primary key, not a
// custom-formatted string column). A sequence guarantees "no
// duplicates" at the database level, not merely by application
// discipline, and is safe under concurrent contract creation without
// needing its own row lock.
//
// Format: "<prefix>-<year>-<6-digit sequence>", e.g. "BARQ-2026-000123".
// `prefix` is configurable per call (defaults to "BARQ") rather than a
// single hardcoded constant, satisfying "sequential or configurable."
// The sequence itself is never reset per year — the year in the number
// is a human-readability aid, not a per-year counter reset, which
// keeps the underlying guarantee simple (one global sequence, always
// monotonic, always unique) rather than needing per-year sequence
// bookkeeping that isn't required by anything in this phase.

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface GenerateContractNumberOptions {
  prefix?: string;
  now?: Date;
}

export async function generateContractNumber(
  options: GenerateContractNumberOptions = {},
  db: DbClient = prisma
): Promise<string> {
  const prefix = options.prefix ?? "BARQ";
  const year = (options.now ?? new Date()).getUTCFullYear();

  const rows = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('booking_contract_number_seq') AS value`;
  const row = rows[0];
  if (!row) {
    throw new Error("generateContractNumber: nextval() returned no row — this should never happen");
  }

  return `${prefix}-${year}-${row.value.toString().padStart(6, "0")}`;
}
