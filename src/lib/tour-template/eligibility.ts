// Smart Tour-Guide Template — the eligibility PREDICATE (TOUR-1). PURE: no
// server-only / prisma, so it is safe to import from the shared write resolver and
// unit-test directly. The DB lookup that resolves the canonical category id lives
// in the server-only companion resolve-tourist-guide-category.ts.
//
// A service is smart-tour-guide eligible iff BOTH:
//   1. the provider is INDIVIDUAL, AND
//   2. the service's category IS the canonical tourist-guide activity.
//
// Identity is by STABLE taxonomy slug `tourist-guides` (ADR-0016) resolved to an
// id — never a translated name, a client string/boolean, or the presence of
// guidingContent. Matching is id-equality, so a name-lookalike category (different
// id) can never qualify. B5 authorization is enforced SEPARATELY by the callers.
// COMPANY providers are explicitly NOT eligible in TOUR-1.

export const TOURIST_GUIDE_CATEGORY_SLUG = "tourist-guides";

export function isSmartTourGuideEligible(params: {
  providerType: string;
  categoryId: string | null;
  touristGuideCategoryId: string | null;
}): boolean {
  const { providerType, categoryId, touristGuideCategoryId } = params;
  if (providerType !== "INDIVIDUAL") return false;
  if (touristGuideCategoryId === null || categoryId === null) return false;
  return categoryId === touristGuideCategoryId;
}
