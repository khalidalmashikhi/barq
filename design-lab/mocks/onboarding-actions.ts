// Storybook-only stand-in for src/app/[locale]/provider/vehicles/new/[vehicleId]/onboarding-actions.ts
// (wired by the resolver in .storybook/main.ts for the REAL onboarding review form's story only).
// The real file is a "use server" module over Prisma and the session; the design lab never talks to a
// server or a database. These keep the real signatures and answer locally: save "works", create and
// cancel report a harmless coded result so the form stays on screen. Nothing is sent anywhere.

import type { RegistrationReviewResult } from "@/lib/vehicles/registration-review/registration-review-result";
import type { FinalizeResult, DeleteDraftResult } from "@/lib/vehicles/onboarding/onboarding-result";

/** Ignores the (synthetic) arguments on purpose and waits briefly, like a real round trip would. */
const pause = (...ignored: unknown[]) => {
  void ignored;
  return new Promise((resolve) => setTimeout(resolve, 300));
};

export async function saveOnboardingDraftAction(vehicleId: string, values: Record<string, unknown>): Promise<RegistrationReviewResult> {
  await pause(vehicleId, values);
  return { ok: true } as RegistrationReviewResult;
}

export async function finalizeVehicleAction(vehicleId: string, values: Record<string, unknown>): Promise<FinalizeResult> {
  await pause(vehicleId, values);
  return { ok: false, code: "VEHICLE_NOT_FOUND" } as FinalizeResult;
}

export async function cancelOnboardingAction(vehicleId: string): Promise<DeleteDraftResult> {
  await pause(vehicleId);
  return { ok: false, code: "VEHICLE_NOT_FOUND" } as DeleteDraftResult;
}
