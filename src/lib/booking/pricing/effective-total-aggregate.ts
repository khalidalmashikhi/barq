import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// DOWNSTREAM MONEY ALIGNMENT — the ONE DB-level effective-booking-total expression for financial
// aggregation: COALESCE(bookingTotalSnapshot, priceSnapshotAmount). Semantically correct for
// financial totals because a LEGACY row's unit snapshot IS its historical total, and a TOTALIZED
// row uses its authoritative total. Centralized here (§13) so this compatibility expression is
// never scattered as raw COALESCE across revenue modules; SUM ignores NULLs, so a row missing
// both simply doesn't contribute.
export const EFFECTIVE_BOOKING_TOTAL = Prisma.sql`COALESCE("bookingTotalSnapshot", "priceSnapshotAmount")`;

const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

export type EffectiveTotalByCurrency = { currency: string; sum: string; avg: string; count: number };

/**
 * Sum / average / count of the effective booking total per currency for bookings matching the
 * caller's WHERE fragment. ONE grouped query — never row-by-row in app memory (§13), never
 * currencies summed together. Decimal-safe: amounts are decimal strings, never Number()/parseFloat.
 */
export async function aggregateEffectiveBookingTotalByCurrency(whereSql: Prisma.Sql): Promise<EffectiveTotalByCurrency[]> {
  const rows = await prisma.$queryRaw<
    Array<{ currency: string | null; sum: Prisma.Decimal | null; avg: Prisma.Decimal | null; count: bigint }>
  >(Prisma.sql`
    SELECT "priceSnapshotCurrency" AS currency,
           SUM(${EFFECTIVE_BOOKING_TOTAL}) AS sum,
           AVG(${EFFECTIVE_BOOKING_TOTAL}) AS avg,
           COUNT(${EFFECTIVE_BOOKING_TOTAL}) AS count
    FROM "bookings"
    WHERE ${whereSql}
    GROUP BY "priceSnapshotCurrency"
  `);
  return rows
    .filter((row) => row.currency !== null && row.sum !== null)
    .map((row) => ({
      currency: row.currency as string,
      sum: new Prisma.Decimal(row.sum as Prisma.Decimal).toDecimalPlaces(2, ROUNDING).toFixed(2),
      avg: row.avg !== null ? new Prisma.Decimal(row.avg).toDecimalPlaces(2, ROUNDING).toFixed(2) : "0.00",
      count: Number(row.count),
    }));
}
