import type { Prisma, RentalOfferingStatus } from "@prisma/client";

// Phase 3C Slice C2b-R — the explicit, allowlisted PROVIDER view of a rental offering. Built
// field-by-field (never a `...row` spread), so internal authorization evidence, private document
// storage metadata, raw Prisma records, raw Decimal objects, and unrelated Service/Vehicle/provider
// fields can never leak. Money is a 2dp string; there is deliberately no `remainingCapacity`.

export type RentalOfferingDTO = {
  id: string;
  serviceId: string;
  vehicleId: string;
  status: RentalOfferingStatus;
  baseDailyAmount: string;
  currency: string;
  /** The vehicle's verified/provider-entered bookable capacity (may be null before approval). */
  verifiedVehicleCapacity: number | null;
  offeringCapacityOverride: number | null;
  /** override ?? verifiedVehicleCapacity — the customer party-size ceiling (never inventory). */
  effectiveCapacity: number | null;
  createdAt: string;
  updatedAt: string;
};

/** The minimal row shape the DTO reads (offering scalars + the vehicle's bookable capacity). */
export type RentalOfferingDtoRow = {
  id: string;
  serviceId: string;
  vehicleId: string;
  status: RentalOfferingStatus;
  baseDailyAmount: Prisma.Decimal;
  currency: string;
  offeringCapacityOverride: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toRentalOfferingDTO(row: RentalOfferingDtoRow, verifiedVehicleCapacity: number | null): RentalOfferingDTO {
  return {
    id: row.id,
    serviceId: row.serviceId,
    vehicleId: row.vehicleId,
    status: row.status,
    baseDailyAmount: row.baseDailyAmount.toFixed(2),
    currency: row.currency,
    verifiedVehicleCapacity,
    offeringCapacityOverride: row.offeringCapacityOverride,
    effectiveCapacity: row.offeringCapacityOverride ?? verifiedVehicleCapacity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Bounded summary counts returned by the bulk-open day mutation. */
export type RentalBulkOpenSummary = {
  created: number; // new OPEN day rows inserted
  opened: number; // existing BLOCKED rows flipped to OPEN (only when reopenBlocked)
  alreadyOpen: number; // existing OPEN rows left unchanged
  blockedKept: number; // existing BLOCKED rows kept BLOCKED (reopenBlocked=false)
};

/** Bounded summary returned by the start-time management mutation. */
export type RentalStartTimesSummary = {
  opened: number;
  closed: number;
  unchanged: number;
};
