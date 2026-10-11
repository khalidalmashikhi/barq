"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { rereadRegistrationDocument, type RereadResult } from "@/lib/vehicles/registration-review/reread-registration";
import { completeRegistrationReading, type CompletionActionResult } from "@/lib/vehicles/registration-review/complete-registration-reading";

// Phase 3C (incomplete native-PDF correction, 2026-10-09) — thin Server Actions for the two
// recovery paths on the review step. Session-derived and owner-scoped in the domain functions;
// auth errors become coded results; no raw error ever reaches the client.

function revalidate(): void {
  revalidatePath("/[locale]/provider/vehicles/new/[vehicleId]", "page");
  revalidatePath("/[locale]/provider/vehicles/[id]", "page");
}

/** "Read document again" — LOCAL re-read of a stale reading; never an external request. */
export async function rereadRegistrationAction(vehicleId: string): Promise<RereadResult> {
  try {
    const result = await rereadRegistrationDocument(vehicleId);
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

/** "Complete automatic reading" — only with the provider's current consent for this exact set. */
export async function completeRegistrationReadingAction(vehicleId: string): Promise<CompletionActionResult> {
  try {
    const result = await completeRegistrationReading(vehicleId);
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
