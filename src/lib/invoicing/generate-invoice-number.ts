import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Invoice Number generation — Phase 2.13 (Invoice Foundation). Mirrors
// src/lib/contracts/contract-number.ts's exact precedent and reasoning.
//
// Backed by the `invoice_number_seq` Postgres sequence (raw SQL, since
// Prisma's schema DSL only supports autoincrement() on an Int primary
// key, not a custom-formatted string column) — a sequence guarantees
// "no duplicates" at the database level, safe under concurrent Invoice
// creation without needing its own row lock.
//
// Format: "<prefix>-<year>-<6-digit sequence>", e.g. "BARQ-2026-000123" —
// identical shape to the Contract number, for the same reason: the year
// is a human-readability aid, not a per-year counter reset.

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface GenerateInvoiceNumberOptions {
  prefix?: string;
  now?: Date;
}

export async function generateInvoiceNumber(
  options: GenerateInvoiceNumberOptions = {},
  db: DbClient = prisma
): Promise<string> {
  const prefix = options.prefix ?? "BARQ";
  const year = (options.now ?? new Date()).getUTCFullYear();

  const rows = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('invoice_number_seq') AS value`;
  const row = rows[0];
  if (!row) {
    throw new Error("generateInvoiceNumber: nextval() returned no row — this should never happen");
  }

  return `${prefix}-${year}-${row.value.toString().padStart(6, "0")}`;
}
