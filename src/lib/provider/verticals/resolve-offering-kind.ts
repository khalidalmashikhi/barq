import "server-only";
import type { OfferingKind } from "@prisma/client";
import { offeringKindForServiceType } from "./vertical-policy";
import { resolveTouristGuideCategoryId } from "@/lib/tour-template/resolve-tourist-guide-category";

// Phase 3B — Phase 1. THE server-authoritative classifier for a service's regulated OfferingKind.
// The client never supplies this; it is derived from the governed taxonomy at every create/edit:
//
//   • serviceType === "RENTAL"                    → VEHICLE_RENTAL   (safely derivable from type)
//   • categoryId === the verified tourist-guide   → TOUR             (taxonomy-anchored, NOT every
//     category (resolveTouristGuideCategoryId)                        EXPERIENCE — only this category)
//   • otherwise                                   → null             (genuinely non-regulated)
//
// This closes the null-kind bypass for guided tours: a new service in the tourist-guide category is
// classified TOUR and therefore gated on the TOURIST_GUIDE vertical, and can never be left null to
// avoid authorization. It deliberately does NOT infer TOUR from a plain EXPERIENCE serviceType (the
// binding correction: "do not classify all EXPERIENCE services as TOUR"). Fail-closed: if the
// tourist-guide taxonomy row is absent, no TOUR classification is applied (never mislabels).
//
// LIMITATION (reported): tour classification is anchored to the single canonical tourist-guide
// category id (the same anchor isSmartTourGuideEligible uses). If tours later become a subtree of
// categories, this must widen to a descendant check — tracked for the tour-engine gate.
export async function resolveOfferingKindForService(input: {
  serviceType: string;
  categoryId: string | null;
}): Promise<OfferingKind | null> {
  const byServiceType = offeringKindForServiceType(input.serviceType);
  if (byServiceType) return byServiceType;

  if (input.categoryId) {
    const touristGuideCategoryId = await resolveTouristGuideCategoryId();
    if (touristGuideCategoryId && input.categoryId === touristGuideCategoryId) return "TOUR";
  }
  return null;
}
