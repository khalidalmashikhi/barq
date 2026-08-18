import { parseGuidingContent, type GuidingContent } from "./guiding-content";
import { isSmartTourGuideEligible } from "./eligibility";

// Smart Tour-Guide Template — the single write-boundary resolver (TOUR-1).
//
// PURE (no DB): the caller resolves the tourist-guide category id once and passes
// it in. Shared by provider create-service and update-service so the rule "a
// guidingContent payload was supplied -> the service MUST be eligible -> it MUST
// parse" lives in exactly one place. A supplied payload can never reach Experience
// without passing BOTH eligibility (INDIVIDUAL + tourist-guide category) and the
// strict parseGuidingContent() contract. Rejection is preferred over silent
// dropping — this is a security/domain boundary.

export type GuidingContentWriteError = "TOUR_TEMPLATE_NOT_ELIGIBLE" | "TOUR_TEMPLATE_INVALID";

export type GuidingContentWrite =
  // No guidingContent field supplied (absent/blank) -> do not touch Experience.
  | { kind: "none" }
  // Eligible + valid -> upsert this normalized value onto Experience.
  | { kind: "set"; value: GuidingContent }
  // Supplied but rejected -> caller returns this error and persists nothing.
  | { kind: "error"; error: GuidingContentWriteError };

export function resolveGuidingContentWrite(params: {
  raw: FormDataEntryValue | null;
  providerType: string;
  categoryId: string | null;
  touristGuideCategoryId: string | null;
}): GuidingContentWrite {
  const { raw, providerType, categoryId, touristGuideCategoryId } = params;

  // Absent or blank field -> not a smart-tour write. (Never a File.)
  if (typeof raw !== "string" || raw.trim() === "") {
    return { kind: "none" };
  }

  // A payload WAS supplied: the target service must be smart-tour eligible, or a
  // client is trying to smuggle tour content onto a generic/COMPANY service.
  if (!isSmartTourGuideEligible({ providerType, categoryId, touristGuideCategoryId })) {
    return { kind: "error", error: "TOUR_TEMPLATE_NOT_ELIGIBLE" };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "error", error: "TOUR_TEMPLATE_INVALID" };
  }

  const parsed = parseGuidingContent(json);
  if (!parsed.ok) {
    return { kind: "error", error: "TOUR_TEMPLATE_INVALID" };
  }
  return { kind: "set", value: parsed.value };
}
