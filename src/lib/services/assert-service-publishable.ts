import "server-only";
import type { OfferingKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getTourVehiclePublishBlocker } from "@/lib/tour-template/vehicle-pool/publish-readiness";
import { evaluateRentalServicePublishable } from "@/lib/offerings/rental/rental-service-publishability";

// The SINGLE source of truth for "may this Service be published" (Task B,
// BR-026). Returns an ORDERED list of blockers so the UI can surface all of
// them at once — a provider is never forced into fix-one, retry, discover-next.
// An empty array means publishable.
//
// Order is intentional and stable (highest-priority first): category, then
// price, then TOUR vehicle readiness, with room for future blockers appended.
// Both the provider and admin service-status transitions call this — the checks
// are never duplicated inline. Like the price rule, the TOUR vehicle rule is a
// FULFILLMENT prerequisite (a published transport tour with no usable vehicle is
// unfulfillable), so it applies to admin governance publish too — never a
// provider-only gate and never a Web-only bypass.
//
// The category check reads categoryId off the already-fetched service row (no
// query); the ACTIVE-price and TOUR-vehicle checks hit the database (bounded).

export type ServicePublishBlocker = "SERVICE_CATEGORY_REQUIRED" | "NO_ACTIVE_PRICE" | "TOUR_VEHICLE_POOL_REQUIRED";

/**
 * Phase 3C Slice C2b-R2 — sentinel thrown INSIDE a Service-publish transaction when the authoritative
 * in-transaction re-check of the daily-rental commercial-price path fails, so the transaction rolls
 * back (no status update, no audit). Carries the blocker list the caller maps to its result. Kept a
 * distinct type so the generic catch can map it deterministically rather than to UNKNOWN_ERROR.
 */
export class ServicePublishBlockedError extends Error {
  constructor(public readonly blockers: ServicePublishBlocker[]) {
    super("SERVICE_PUBLISH_BLOCKED");
    this.name = "ServicePublishBlockedError";
  }
}

export async function assertServicePublishable(
  service: {
    id: string;
    categoryId: string | null;
    providerId: string;
    /**
     * The service's server-authoritative OfferingKind. Only `VEHICLE_RENTAL` unlocks the C2b-R2
     * daily-offering price path (Path B); omitted / any other kind keeps the legacy Path-A rule
     * unchanged (byte-for-byte). Never client-supplied — read from the persisted Service row.
     */
    offeringKind?: OfferingKind | null;
  },
  now: Date = new Date(),
): Promise<ServicePublishBlocker[]> {
  const blockers: ServicePublishBlocker[] = [];

  // 1. Category required (BR-026).
  if (!service.categoryId) {
    blockers.push("SERVICE_CATEGORY_REQUIRED");
  }

  // 2. A usable commercial price required (a priceless, unbookable service must not publish).
  //    Path A — the unchanged legacy ACTIVE Price rule. For a VEHICLE_RENTAL service ONLY, Path B —
  //    a valid PUBLISHED daily RentalOffering (C2b-R2) — may satisfy this instead, WITHOUT weakening
  //    Path A and WITHOUT making any PER_DAY / PER_VEHICLE_DAY Price row bookable. Every other kind
  //    keeps the legacy behavior exactly.
  const activePrice = await prisma.price.findFirst({
    where: { serviceId: service.id, status: "ACTIVE" },
  });
  if (!activePrice) {
    // Path B (rental only). A CANDIDATE_LIMIT_EXCEEDED overflow maps to the SAME public NO_ACTIVE_PRICE
    // as "no candidate qualified" — the distinct internal reason is logged inside the evaluator; the
    // public blocker never leaks candidate/overflow details.
    const rentalDaily =
      service.offeringKind === "VEHICLE_RENTAL"
        ? await evaluateRentalServicePublishable(prisma, { serviceId: service.id, now })
        : ({ publishable: false, reason: "NO_CANDIDATE" } as const);
    if (!rentalDaily.publishable) {
      blockers.push("NO_ACTIVE_PRICE");
    }
  }

  // 3. TOUR-VEHICLE-2P — a transport tour must have at least one CURRENTLY ELIGIBLE
  // pooled vehicle. Null for non-tour / GUIDE_ONLY / PRIVATE_CUSTOM_TOUR (optional).
  const tourVehicleBlocker = await getTourVehiclePublishBlocker({ id: service.id, providerId: service.providerId });
  if (tourVehicleBlocker) {
    blockers.push(tourVehicleBlocker);
  }

  return blockers;
}
