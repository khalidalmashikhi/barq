"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { writeRegistrationConfirmation } from "@/lib/vehicles/registration-review/write-confirmation";
import { finalizeVehicleFromRegistration } from "@/lib/vehicles/onboarding/finalize-vehicle";
import { deleteDraftVehicle } from "@/lib/vehicles/onboarding/delete-draft-vehicle";
import type { RegistrationReviewResult } from "@/lib/vehicles/registration-review/registration-review-result";
import type { FinalizeResult, DeleteDraftResult } from "@/lib/vehicles/onboarding/onboarding-result";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Server Actions for the onboarding wizard
// step 2 (review & confirm). Thin adapters over the session-derived, owner-scoped domain functions
// (RENTAL_COMPANY-gated). Auth errors become coded results — a non-approved / non-rental provider
// gets the non-enumerating VEHICLE_NOT_FOUND, never a thrown error at the client.

function revalidateStep(): void {
  revalidatePath("/[locale]/provider/vehicles/new/[vehicleId]", "page");
}

// Optional "save progress" — persists the provider's confirmation edits as a DRAFT claim (no
// Vehicle write). Reuses the Slice-3A writer so draft semantics/supersession stay identical.
export async function saveOnboardingDraftAction(vehicleId: string, values: Record<string, unknown>): Promise<RegistrationReviewResult> {
  try {
    const result = await writeRegistrationConfirmation("DRAFT", vehicleId, values);
    if (result.ok) revalidateStep();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

// Confirm & create — applies the confirmed values to the DRAFT Vehicle and locks the claim.
export async function finalizeVehicleAction(vehicleId: string, values: Record<string, unknown>): Promise<FinalizeResult> {
  try {
    const result = await finalizeVehicleFromRegistration(vehicleId, values);
    if (result.ok) revalidateStep();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

// Cancel — discards an unfinished shell and reclaims its private document.
export async function cancelOnboardingAction(vehicleId: string): Promise<DeleteDraftResult> {
  try {
    return await deleteDraftVehicle(vehicleId);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
