import "server-only";
import { prisma } from "@/lib/db";
import { getTourVehiclePublishBlocker } from "@/lib/tour-template/vehicle-pool/publish-readiness";

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

export async function assertServicePublishable(service: {
  id: string;
  categoryId: string | null;
  providerId: string;
}): Promise<ServicePublishBlocker[]> {
  const blockers: ServicePublishBlocker[] = [];

  // 1. Category required (BR-026).
  if (!service.categoryId) {
    blockers.push("SERVICE_CATEGORY_REQUIRED");
  }

  // 2. At least one ACTIVE price required (a priceless service is unbookable).
  const activePrice = await prisma.price.findFirst({
    where: { serviceId: service.id, status: "ACTIVE" },
  });
  if (!activePrice) {
    blockers.push("NO_ACTIVE_PRICE");
  }

  // 3. TOUR-VEHICLE-2P — a transport tour must have at least one CURRENTLY ELIGIBLE
  // pooled vehicle. Null for non-tour / GUIDE_ONLY / PRIVATE_CUSTOM_TOUR (optional).
  const tourVehicleBlocker = await getTourVehiclePublishBlocker({ id: service.id, providerId: service.providerId });
  if (tourVehicleBlocker) {
    blockers.push(tourVehicleBlocker);
  }

  return blockers;
}
