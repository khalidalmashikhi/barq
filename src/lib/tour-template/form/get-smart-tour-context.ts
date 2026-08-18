import "server-only";
import type { Locale } from "@/i18n/locales";
import { getSmartTourFormConfig, type SmartTourFormConfig } from "./get-smart-tour-form-config";
import { resolveTouristGuideCategoryId } from "../resolve-tourist-guide-category";
import { getGuideProfileSummary } from "./get-guide-profile-summary";
import { readGuidingContentForEdit } from "../read-guiding-content";
import { hydrateTourFormState, type TourFormState } from "./tour-form-state";
import { getProviderCategoryChips } from "@/lib/provider/get-provider-categories";
import type { GuideProfileSummary } from "./guide-profile";

// Smart Tour-Guide Template — assembles the server-derived smart-tour context the
// provider service pages hand to <TourAwareCategoryField> (TOUR-2). Eligibility is
// server-authoritative: only INDIVIDUAL providers get a smart config, and the
// canonical category id comes from the stable slug. COMPANY (or a missing
// taxonomy row) yields a null config → the generic form only. Edit hydration is
// gated on the service ALREADY being the tourist-guide category, and a malformed
// stored value surfaces a recovery flag instead of crashing.

export type SmartTourContext = {
  providerType: string;
  touristGuideCategoryId: string | null;
  smartConfig: SmartTourFormConfig | null;
  guideProfile: GuideProfileSummary | null;
  initialTourState: TourFormState | null;
  tourMalformed: boolean;
};

const INELIGIBLE = (providerType: string, touristGuideCategoryId: string | null): SmartTourContext => ({
  providerType,
  touristGuideCategoryId,
  smartConfig: null,
  guideProfile: null,
  initialTourState: null,
  tourMalformed: false,
});

export async function getSmartTourContext(params: {
  providerId: string;
  providerType: string;
  locale: Locale;
  serviceId?: string | null;
  serviceCategoryId?: string | null;
}): Promise<SmartTourContext> {
  const { providerId, providerType, locale, serviceId = null, serviceCategoryId = null } = params;

  const touristGuideCategoryId = await resolveTouristGuideCategoryId();

  // Only INDIVIDUAL providers with a resolvable canonical category get the smart UI.
  if (providerType !== "INDIVIDUAL" || touristGuideCategoryId === null) {
    return INELIGIBLE(providerType, touristGuideCategoryId);
  }

  const chips = await getProviderCategoryChips(providerId, locale);
  const activityLabel = chips.find((chip) => chip.id === touristGuideCategoryId)?.label ?? chips[0]?.label ?? null;

  const [smartConfig, guideProfile] = await Promise.all([
    getSmartTourFormConfig(locale),
    getGuideProfileSummary(providerId, locale, activityLabel),
  ]);

  // Edit hydration only when THIS service is already the tourist-guide category.
  let initialTourState: TourFormState | null = null;
  let tourMalformed = false;
  if (serviceId && serviceCategoryId === touristGuideCategoryId) {
    const read = await readGuidingContentForEdit(serviceId);
    tourMalformed = read.kind === "malformed";
    initialTourState = hydrateTourFormState(read.value);
  }

  return { providerType, touristGuideCategoryId, smartConfig, guideProfile, initialTourState, tourMalformed };
}
