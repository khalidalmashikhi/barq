"use server";

import { cancelVehicleOnboardingRequest } from "@/lib/vehicles/onboarding/cancel-onboarding-request";

// Phase 3C Slice 3B — Server Action for the upload step: cancel an onboarding attempt BY ITS REQUEST
// KEY. The upload form calls it when the provider leaves after a submission whose outcome the
// browser does not know (dropped connection / still in flight), so a delayed upload carrying that
// key can no longer create anything, and anything it already created is removed.
//
// A thin adapter: authority, provider scoping, the tombstone and all cleanup live in the domain
// function. The result is a bare yes/no — it reveals nothing about what existed for the key.

export async function cancelOnboardingRequestAction(requestKey: string): Promise<{ ok: boolean }> {
  try {
    const result = await cancelVehicleOnboardingRequest(requestKey);
    return { ok: result.ok };
  } catch {
    return { ok: false }; // unauthenticated / unexpected — the browser keeps its key
  }
}
