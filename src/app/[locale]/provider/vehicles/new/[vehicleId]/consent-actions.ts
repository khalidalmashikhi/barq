"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { decideRegistrationOcrConsent, type OcrConsentDecisionResult } from "@/lib/vehicles/registration-review/decide-ocr-consent";

// Phase 3C (registration OCR privacy gate) — Server Actions for the provider's choice on the review
// step: have the uploaded registration document read automatically (external processing, with the
// recorded consent) or enter the details manually. Thin adapters over the session-derived,
// owner-scoped domain function; auth errors become coded results (never thrown to the client); a
// non-approved provider gets the non-enumerating VEHICLE_NOT_FOUND. The interface language is read
// on the server (the notice version + language are part of the recorded proof).

function revalidate(): void {
  revalidatePath("/[locale]/provider/vehicles/new/[vehicleId]", "page");
  revalidatePath("/[locale]/provider/vehicles/[id]", "page");
}

async function decide(vehicleId: string, decision: "GRANTED" | "DECLINED", ownerAuthorizationConfirmed: boolean): Promise<OcrConsentDecisionResult> {
  try {
    const locale = await getLocale();
    const result = await decideRegistrationOcrConsent(vehicleId, decision, { ownerAuthorizationConfirmed, locale });
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

/** The provider agrees to external automatic reading of THIS document and attests ownership/authorization. */
export async function grantOcrConsentAction(vehicleId: string, ownerAuthorizationConfirmed: boolean): Promise<OcrConsentDecisionResult> {
  return decide(vehicleId, "GRANTED", ownerAuthorizationConfirmed === true);
}

/** The provider chooses manual entry; nothing is sent anywhere. */
export async function declineOcrConsentAction(vehicleId: string): Promise<OcrConsentDecisionResult> {
  return decide(vehicleId, "DECLINED", false);
}
