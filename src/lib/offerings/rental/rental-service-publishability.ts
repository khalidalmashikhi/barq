import "server-only";
import type { Prisma } from "@prisma/client";
import { omanDateKey } from "@/lib/date/oman-time";
import {
  assertProviderStillApproved,
  assertRentalVerticalCompliant,
  assertRentalVehicleReady,
  RENTAL_VEHICLE_SELECT,
  type DbClient,
  type LoadedRentalVehicle,
} from "./rental-offering-authorization";
import { parseOfferingAmount, normalizeOfferingCurrency, checkCapacityOverride } from "./rental-offering-validation";

// A defensive upper bound on the number of PUBLISHED candidate offerings evaluated for one Service.
// One non-ARCHIVED offering exists per (serviceId, vehicleId), so this equals the count of a
// provider's vehicles offered on this service — naturally small; 100 is far beyond any real fleet and
// guarantees the candidate loop (and its per-candidate OPEN-day existence query) cannot grow without
// bound. Exceeding it fails closed (a valid offering past the cap is simply not seen → NO_ACTIVE_PRICE).
export const RENTAL_SERVICE_PUBLISH_CANDIDATE_LIMIT = 100;

// Phase 3C Slice C2b-R2 — the SHARED, TRANSACTION-CAPABLE rental-offering readiness authority used by
// BOTH C2b-R offering publication and C2b-R2 daily-rental Service publication, so the two can never
// disagree. It reuses the SAME per-offering readiness core as C2b-R (assertRentalPublishReady =
// vertical compliance + vehicle selectability + verified capacity) plus one canonical OPEN-day/rate
// rule, rather than a copied simplified subset. Every read runs on the supplied db (tx) client;
// nothing is trusted from client input.

const RENTAL_OFFERING_KIND = "VEHICLE_RENTAL" as const;

/** Start of today's Oman calendar day as the UTC-midnight instant matching a `@db.Date` value. */
export function omanTodayDbDateBoundary(now: Date = new Date()): Date {
  return new Date(`${omanDateKey(now)}T00:00:00.000Z`);
}

/**
 * The single OPEN-day/rate rule (no duplicated date-boundary logic): at least one explicit OPEN,
 * non-past (Oman calendar) OfferingDay exists for the offering. An OPEN day always resolves an
 * authoritative POSITIVE daily rate — `dailyAmountOverride ?? baseDailyAmount`, both DB-CHECK'd > 0
 * — so its existence is sufficient. Reused by C2b-R `publishRentalOffering` and the C2b-R2 bridge.
 */
export async function hasPublishableOpenDay(db: DbClient, offeringId: string, now: Date = new Date()): Promise<boolean> {
  const day = await db.rentalOfferingDay.findFirst({
    where: { rentalOfferingId: offeringId, state: "OPEN", serviceDate: { gte: omanTodayDbDateBoundary(now) } },
    select: { id: true },
  });
  return day !== null;
}

type CandidateOfferingRow = {
  id: string;
  baseDailyAmount: Prisma.Decimal;
  currency: string;
  offeringCapacityOverride: number | null;
  vehicle: LoadedRentalVehicle;
};

/**
 * C2b-R2 Path B: does the VEHICLE_RENTAL Service satisfy the commercial-price requirement through a
 * valid PUBLISHED daily RentalOffering (rather than a legacy ACTIVE Price)? Returns true only when
 * EVERY locked condition holds for at least one offering — fail-closed on anything missing/foreign/
 * non-compliant/unreadable. All reads use the supplied db (tx) client. Never trusts client input.
 *
 * Conditions (per the approved contract):
 *   • Service still resolves to VEHICLE_RENTAL and belongs to `providerId` (re-read here).
 *   • Provider overall status still APPROVED (assertProviderStillApproved).
 *   • Offering: serviceId matches, status PUBLISHED, Vehicle owned by the same provider.
 *   • Vertical APPROVED + compliant, Vehicle selectable (ACTIVE+APPROVED+docs), verified capacity
 *     present — the SAME assertRentalPublishReady C2b-R publish uses.
 *   • Base daily amount valid+positive; currency present/valid; capacity override null or a positive
 *     integer ≤ verified capacity (fail-closed re-validation of the stored values).
 *   • >= 1 explicit OPEN non-past day resolving a positive rate (hasPublishableOpenDay).
 * A vehicle-reservation conflict is deliberately NOT consulted — availability varies by date and is
 * resolved later (C3); Service-publish eligibility must not imply the vehicle is free on any date.
 */
export async function evaluateRentalServicePublishable(
  db: DbClient,
  params: { serviceId: string; now?: Date },
): Promise<boolean> {
  const now = params.now ?? new Date();

  // Re-read the Service kind + owner on the supplied client (never trust a caller-passed kind).
  const service = await db.service.findUnique({
    where: { id: params.serviceId },
    select: { providerId: true, offeringKind: true },
  });
  if (!service || service.offeringKind !== RENTAL_OFFERING_KIND) return false;

  // Provider overall approval, re-read on the same client.
  if ((await assertProviderStillApproved(db, service.providerId)) !== null) return false;

  // Vertical APPROVED + compliant (status + policy + evidence, all on the supplied client). A
  // provider-global fact — evaluated ONCE here, not per candidate, so a non-compliant vertical fails
  // the whole evaluation and never re-queries per offering (no N+1 on compliance).
  if ((await assertRentalVerticalCompliant(db, service.providerId)) !== null) return false;

  // Candidate PUBLISHED offerings for THIS service whose Vehicle the SAME provider owns (a foreign
  // vehicle/offering/service simply does not match — non-enumerating). Ordered deterministically so
  // the outcome never depends on DB return order, and capped so the candidate loop cannot grow
  // unbounded. NO start-time rows are loaded; each candidate's day check is a single existence query.
  const offerings = (await db.rentalOffering.findMany({
    where: {
      serviceId: params.serviceId,
      status: "PUBLISHED",
      vehicle: { asset: { providerId: service.providerId, assetType: "VEHICLE" } },
    },
    select: {
      id: true,
      baseDailyAmount: true,
      currency: true,
      offeringCapacityOverride: true,
      vehicle: { select: RENTAL_VEHICLE_SELECT },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: RENTAL_SERVICE_PUBLISH_CANDIDATE_LIMIT,
  })) as unknown as CandidateOfferingRow[];

  for (const offering of offerings) {
    // Candidate-local: this Vehicle selectable + verified capacity (disqualifies only this offering).
    if (assertRentalVehicleReady(offering.vehicle, now) !== null) continue;
    // Authoritative money/currency/capacity-override re-validation (fail-closed, candidate-local).
    if (parseOfferingAmount(offering.baseDailyAmount) === null) continue;
    if (normalizeOfferingCurrency(offering.currency) === null) continue;
    if (!checkCapacityOverride(offering.vehicle.bookablePassengerCapacity, offering.offeringCapacityOverride).ok) continue;
    // >= 1 OPEN non-past day resolving a positive daily rate (single existence query per candidate).
    if (!(await hasPublishableOpenDay(db, offering.id, now))) continue;
    return true; // this offering satisfies every Path B condition
  }
  return false;
}
