import type { RentalOfferingStatus } from "@prisma/client";
import type { RentalReadinessBlockerCode } from "./rental-offering-status";

// Phase 3C Slice C2d-R1 — the explicit, allowlisted PROVIDER read models for the rental-management
// workspace (list + detail + overview). Built field-by-field (never a `...row` spread): internal
// authorization evidence, private document metadata, raw Prisma/Decimal objects, and the vehicle's
// private registration plate never leak. Money is always a 2dp string; passenger capacity is
// metadata (never inventory, never a price multiplier). This is a READ surface only.

/** One row in the provider's rental-offering list. */
export type ProviderRentalOfferingListItem = {
  id: string;
  status: RentalOfferingStatus;
  serviceId: string;
  /** Localized service name (fallback chain applied). */
  serviceName: string;
  vehicleId: string;
  /** make + model, or null when neither is set (caller shows a localized fallback). */
  vehicleTitle: string | null;
  /** Canonical vehicle-type code (the caller localizes it); null when unset. */
  vehicleType: string | null;
  /** Verified/provider-entered bookable capacity (party-size metadata; null before approval). */
  bookablePassengerCapacity: number | null;
  offeringCapacityOverride: number | null;
  /** override ?? bookablePassengerCapacity — the party-size ceiling (never inventory). */
  effectiveCapacity: number | null;
  baseDailyAmount: string; // 2dp string
  currency: string;
  // OPEN is provider CONFIGURATION state, NOT reservation-aware customer availability (holds /
  // confirmations are resolved by the C3/E authority + the C2c customer calendar, not here).
  /** Nearest configured OPEN day today-or-later (Oman key), or null when none is configured. */
  nearestConfiguredOpenDateKey: string | null;
  /** The single most-relevant readiness/compliance blocker, or null when ready. Never a doc id. */
  readinessBlocker: RentalReadinessBlockerCode | null;
};

/** One configured day of an offering, with its authoritative resolved price. */
export type ProviderRentalOfferingDay = {
  dateKey: string;
  state: "OPEN" | "BLOCKED";
  /** Resolved daily price for the date: the day override when present, else the offering base. */
  dailyAmount: string; // 2dp string
  currency: string;
  priceSource: "BASE" | "OVERRIDE";
};

/** The provider's read-only detail view of one owned offering + its configured days. */
export type ProviderRentalOfferingDetail = {
  id: string;
  status: RentalOfferingStatus;
  serviceId: string;
  serviceName: string;
  vehicleId: string;
  vehicleTitle: string | null;
  vehicleType: string | null;
  vehicleColor: string | null;
  vehicleModelYear: number | null;
  bookablePassengerCapacity: number | null;
  /** Official registered seats (provider-private metadata; distinct from bookable capacity). */
  registeredSeats: number | null;
  offeringCapacityOverride: number | null;
  effectiveCapacity: number | null;
  baseDailyAmount: string;
  currency: string;
  readinessBlocker: RentalReadinessBlockerCode | null;
  /** Configured days sorted ascending by Oman date. Days with no row are simply absent. */
  configuredDays: ProviderRentalOfferingDay[];
  // OPEN is provider CONFIGURATION state, not reservation-aware customer availability.
  /** Count of configured OPEN days today-or-later. */
  upcomingConfiguredOpenDays: number;
};

/** Operational summary of the provider's rental inventory, all authoritatively derived. */
export type ProviderRentalOverview = {
  /** Non-archived offerings (draft + published + suspended). */
  totalOfferings: number;
  draftOfferings: number;
  publishedOfferings: number;
  suspendedOfferings: number;
  /** Provider VEHICLE assets that currently pass rental readiness (selectable + verified capacity). */
  vehiclesReadyForRental: number;
  /** Provider VEHICLE assets that do NOT yet pass rental readiness. */
  vehiclesRequiringVerification: number;
  // OPEN is provider CONFIGURATION state, NOT reservation-aware customer availability.
  /** Configured OPEN days today-or-later across all the provider's offerings. */
  upcomingConfiguredOpenDays: number;
};
