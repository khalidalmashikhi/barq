import "server-only";
import type { CommissionTier } from "@prisma/client";

// Commission calculation — Phase 2.11 (Checkout Foundation).
//
// GENUINELY MISSING PIECE FOUND DURING INSPECTION: Booking.
// commissionSnapshotAmount/commissionSnapshotTier have existed in the
// schema since Phase 4.1's backfill (schema comment: "Commission
// snapshot at confirmation"), and are already read by the admin Booking
// detail query (Phase 2.9), but no application code anywhere ever
// WROTE them — only prisma/seed.ts faked realistic-looking values
// directly at insert time, with its own comment explicitly documenting
// the intended real rule: "Commission snapshot only set once a booking
// is CONFIRMED/COMPLETED... amount computed from the provider's real
// seeded Commission (10%), not an arbitrary number." This module is
// that real computation, finally wired to the one and only code path
// that transitions a Booking to CONFIRMED (accept-booking.ts) — see
// that file for the integration.
//
// PERCENTAGES: GLOSSARY.md term 19 — "One of BARQ's three defined
// commission rates (12%, 10%, 8%)" — the tier name already encodes its
// rate; this is not a new business decision, just the first place that
// rate is expressed in code rather than only in documentation and a
// seed-script literal.
//
// PRECISION: rounds to 2 decimal places, matching Booking.
// commissionSnapshotAmount's actual column type (@db.Decimal(12, 2)) —
// prisma/seed.ts's own `.toFixed(3)` had no effect once Postgres stored
// it at 2-decimal precision (verified against real seeded rows), so
// this uses the column's real precision directly rather than
// replicating that harmless but misleading seed-script quirk.

const COMMISSION_TIER_RATES: Record<CommissionTier, number> = {
  TIER_12: 0.12,
  TIER_10: 0.1,
  TIER_8: 0.08,
};

export function calculateCommissionAmount(priceAmount: string | number, tier: CommissionTier): string {
  const price = typeof priceAmount === "string" ? Number(priceAmount) : priceAmount;
  return (price * COMMISSION_TIER_RATES[tier]).toFixed(2);
}
