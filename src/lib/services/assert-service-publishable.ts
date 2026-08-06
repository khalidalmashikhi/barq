import "server-only";
import { prisma } from "@/lib/db";

// The SINGLE source of truth for "may this Service be published" (Task B,
// BR-026). Returns an ORDERED list of blockers so the UI can surface all of
// them at once — a provider is never forced into fix-one, retry, discover-next.
// An empty array means publishable.
//
// Order is intentional and stable (highest-priority first): category before
// price, with room for future blockers appended. Both the provider and admin
// service-status transitions call this — the price/category checks are never
// duplicated inline. Kept deliberately small and specific: two checks, not a
// rule engine.
//
// The category check reads categoryId off the already-fetched service row (no
// query); only the ACTIVE-price check hits the database.

export type ServicePublishBlocker = "SERVICE_CATEGORY_REQUIRED" | "NO_ACTIVE_PRICE";

export async function assertServicePublishable(service: {
  id: string;
  categoryId: string | null;
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

  return blockers;
}
