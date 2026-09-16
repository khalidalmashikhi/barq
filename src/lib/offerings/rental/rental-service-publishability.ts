import "server-only";
import type { Prisma } from "@prisma/client";
import { omanDateKey } from "@/lib/date/oman-time";
import { logger } from "@/lib/logger";
import {
  assertProviderStillApproved,
  assertRentalVerticalCompliant,
  assertRentalVehicleReady,
  RENTAL_VEHICLE_SELECT,
  type DbClient,
  type LoadedRentalVehicle,
} from "./rental-offering-authorization";
import { parseOfferingAmount, normalizeOfferingCurrency, checkCapacityOverride } from "./rental-offering-validation";

// Deterministic keyset page size for scanning PUBLISHED candidate offerings (ordered by unique id).
export const RENTAL_SERVICE_PUBLISH_PAGE_SIZE = 50;

// A deliberately HIGH but explicit safety ceiling — protection against pathological data, NOT a
// normal fleet limit. One non-ARCHIVED offering exists per (serviceId, vehicleId), so a real Service
// has far fewer candidates than this. If the scan reaches the ceiling while MORE candidates still
// exist, the evaluator does NOT quietly conclude "no candidate qualified" (which would silently drop
// a valid offering past the ceiling); it returns the distinct CANDIDATE_LIMIT_EXCEEDED reason so the
// Service-publication boundary fails closed AND logs it, rather than mis-mapping to a plain NO_ACTIVE_PRICE.
export const MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES = 1000;

/**
 * The result of the C2b-R2 daily-rental publishability scan. `publishable: true` ⇒ ≥ 1 fully-valid
 * PUBLISHED offering qualifies (Path B satisfied). `NO_CANDIDATE` ⇒ the FULL candidate set was scanned
 * and none qualified. `CANDIDATE_LIMIT_EXCEEDED` ⇒ the safety ceiling was hit while more candidates
 * remained (pathological data) — the caller must fail closed WITHOUT concluding the set was fully checked.
 */
export type RentalServicePublishableResult =
  | { publishable: true }
  | { publishable: false; reason: "NO_CANDIDATE" | "CANDIDATE_LIMIT_EXCEEDED" };

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
 *   • >= 1 explicit OPEN non-past day resolving a positive rate (batched per page, see below).
 * A vehicle-reservation conflict is deliberately NOT consulted — availability varies by date and is
 * resolved later (C3); Service-publish eligibility must not imply the vehicle is free on any date.
 *
 * Scanning strategy: after the provider/service-GLOBAL gates (fail the whole evaluation once), the
 * PUBLISHED candidate offerings are walked with DETERMINISTIC KEYSET pagination (order by unique
 * `id`, `id > cursor`, page size {@link RENTAL_SERVICE_PUBLISH_PAGE_SIZE}) so a valid candidate's
 * position never changes the result. Candidate-LOCAL readiness (vehicle + money/currency/capacity) is
 * filtered IN MEMORY per page; the OPEN-non-past-day requirement is then a SINGLE batched existence
 * query for the whole page (distinct offering ids that have a qualifying day) — no per-candidate day
 * query (no N+1) and NO start-time / unbounded day-history load. The scan stops at the first qualifying
 * candidate. It never scans beyond {@link MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES}; if it hits that
 * ceiling while more candidates remain, it returns CANDIDATE_LIMIT_EXCEEDED (fail-closed, logged)
 * rather than a false "no candidate qualified".
 */
export async function evaluateRentalServicePublishable(
  db: DbClient,
  params: { serviceId: string; now?: Date },
): Promise<RentalServicePublishableResult> {
  const now = params.now ?? new Date();
  const NO_CANDIDATE = { publishable: false, reason: "NO_CANDIDATE" } as const;

  // ---- PROVIDER/SERVICE-GLOBAL gates: any failure fails the ENTIRE evaluation immediately ----
  const service = await db.service.findUnique({
    where: { id: params.serviceId },
    select: { providerId: true, offeringKind: true },
  });
  if (!service || service.offeringKind !== RENTAL_OFFERING_KIND) return NO_CANDIDATE;
  if ((await assertProviderStillApproved(db, service.providerId)) !== null) return NO_CANDIDATE;
  // Vertical APPROVED + compliant (status + policy + evidence, all on the supplied client) — a
  // provider-global fact evaluated ONCE, before any candidate paging (no N+1 on compliance).
  if ((await assertRentalVerticalCompliant(db, service.providerId)) !== null) return NO_CANDIDATE;

  const baseWhere = {
    serviceId: params.serviceId,
    status: "PUBLISHED" as const,
    vehicle: { asset: { providerId: service.providerId, assetType: "VEHICLE" as const } },
  };
  const boundary = omanTodayDbDateBoundary(now);

  // ---- Bounded keyset scan of PUBLISHED candidates (deterministic by unique id) ----
  let cursor: string | null = null;
  let inspected = 0;
  while (inspected < MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES) {
    const take = Math.min(RENTAL_SERVICE_PUBLISH_PAGE_SIZE, MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES - inspected);
    const page = (await db.rentalOffering.findMany({
      where: cursor === null ? baseWhere : { ...baseWhere, id: { gt: cursor } },
      select: {
        id: true,
        baseDailyAmount: true,
        currency: true,
        offeringCapacityOverride: true,
        vehicle: { select: RENTAL_VEHICLE_SELECT },
      },
      orderBy: { id: "asc" },
      take,
    })) as unknown as CandidateOfferingRow[];
    if (page.length === 0) return NO_CANDIDATE; // the full set is exhausted

    // Candidate-LOCAL readiness, filtered in memory (no query): vehicle selectable + verified
    // capacity + valid money/currency/capacity-override. A failure disqualifies only that offering.
    const ready = page.filter(
      (o) =>
        assertRentalVehicleReady(o.vehicle, now) === null &&
        parseOfferingAmount(o.baseDailyAmount) !== null &&
        normalizeOfferingCurrency(o.currency) !== null &&
        checkCapacityOverride(o.vehicle.bookablePassengerCapacity, o.offeringCapacityOverride).ok,
    );
    // ONE batched OPEN-non-past-day existence query for the whole page (distinct offering ids that
    // have >= 1 qualifying day). No per-candidate query, no start-times, no unbounded day history.
    if (ready.length > 0) {
      const withDay = (await db.rentalOfferingDay.findMany({
        where: { rentalOfferingId: { in: ready.map((o) => o.id) }, state: "OPEN", serviceDate: { gte: boundary } },
        select: { rentalOfferingId: true },
        distinct: ["rentalOfferingId"],
      })) as unknown as { rentalOfferingId: string }[];
      if (withDay.length > 0) return { publishable: true }; // >= 1 candidate satisfies every Path B condition
    }

    inspected += page.length;
    cursor = page[page.length - 1]!.id;
    if (page.length < take) return NO_CANDIDATE; // partial page ⇒ the full set is exhausted
  }

  // Reached the safety ceiling. If NO more candidates exist beyond it, the set was fully scanned →
  // NO_CANDIDATE. If more remain, do NOT claim "none qualified" — surface the distinct overflow reason.
  const more = await db.rentalOffering.findFirst({
    where: { ...baseWhere, id: { gt: cursor! } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!more) return NO_CANDIDATE;
  logger.warn("rental_service_publishable.candidate_limit_exceeded", { serviceId: params.serviceId, inspected });
  return { publishable: false, reason: "CANDIDATE_LIMIT_EXCEEDED" };
}
