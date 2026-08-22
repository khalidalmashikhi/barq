import "server-only";
import { prisma } from "@/lib/db";
import { parseGuidingContent } from "../guiding-content";
import { TOUR_PACKAGE_SEMANTICS } from "../packages";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type PoolVehicleRow } from "./pool-dto";

// TOUR-VEHICLE-2P — the publish-readiness vehicle check. Answers "does this tour service
// PROMISE transport but lack ANY currently-eligible pooled vehicle?" and returns the
// single publish blocker or null. It reuses the SAME live-eligibility authority as the
// pool readers (getVehicleAssignmentBlockers, via evaluatePoolVehicle) — never a mere
// row-count, never a duplicated rule — so a pooled-but-now-ineligible vehicle (not ACTIVE,
// verification not APPROVED, required doc missing/expired, not trusted-4x4 for a 4x4 tour,
// or too small for maxGuests) does NOT satisfy publish. Eligibility is recomputed at
// publish time (fresh Date), so stale eligibility can never be smuggled past the gate.
//
// Only GUIDE_WITH_TRANSPORT / GUIDE_WITH_4X4 (includesTransport) require a vehicle to
// publish. GUIDE_ONLY (no transport) and PRIVATE_CUSTOM_TOUR (vehicle OPTIONAL) never do —
// exactly the authoritative TOUR_PACKAGE_SEMANTICS, no invented custom-tour rule. A
// non-tour service (no Experience/guidingContent) or one whose stored content is
// unparseable is not a tour-vehicle context and is never blocked here.
//
// Ownership is ALREADY enforced by the caller (the publish transition re-checks
// service.providerId); this helper only reads. Bounded: one Experience query + one pool
// query (with each vehicle's Asset status axes + documents) — never one query per vehicle.

export async function getTourVehiclePublishBlocker(service: {
  id: string;
  providerId: string;
}): Promise<"TOUR_VEHICLE_POOL_REQUIRED" | null> {
  const experience = await prisma.experience.findUnique({
    where: { serviceId: service.id },
    select: { guidingContent: true },
  });
  const guidingContent = experience?.guidingContent;
  if (guidingContent == null) return null; // not a tour service

  const parsed = parseGuidingContent(guidingContent);
  if (!parsed.ok) return null; // unparseable → not an enforceable tour-vehicle context

  const semantics = TOUR_PACKAGE_SEMANTICS[parsed.value.packageType];
  // A vehicle is required to PUBLISH only for transport packages (GUIDE_WITH_TRANSPORT /
  // GUIDE_WITH_4X4). GUIDE_ONLY and PRIVATE_CUSTOM_TOUR (optional) never gate publish.
  if (!semantics.includesTransport) return null;

  const rows = await prisma.tourServiceVehicle.findMany({
    where: { serviceId: service.id },
    select: { vehicle: { select: POOL_VEHICLE_SELECT } },
  });

  const context = {
    serviceId: service.id,
    providerId: service.providerId,
    packageType: parsed.value.packageType,
    maxGuests: parsed.value.maxGuests,
  };
  const now = new Date();
  const hasEligible = rows.some(
    (r) => evaluatePoolVehicle(r.vehicle as unknown as PoolVehicleRow, context, now).blockers.length === 0,
  );

  return hasEligible ? null : "TOUR_VEHICLE_POOL_REQUIRED";
}
