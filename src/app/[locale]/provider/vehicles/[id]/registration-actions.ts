"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { runRegistrationAnalysis } from "@/lib/vehicles/registration-review/run-registration-analysis";
import { writeRegistrationConfirmation } from "@/lib/vehicles/registration-review/write-confirmation";
import type { RegistrationReviewResult, RegistrationAnalysisResult } from "@/lib/vehicles/registration-review/registration-review-result";

// Phase 3C Slice 3A — provider registration-review Server Actions. Thin adapters over the
// session-derived, owner-scoped domain functions (which never trust a client provider id). Auth
// errors are mapped to coded results (never thrown to the client); a non-approved provider gets the
// non-enumerating VEHICLE_NOT_FOUND. No file upload here (document upload keeps its own multipart
// route) — these run on the already-uploaded document.

function revalidateDetail(): void {
  revalidatePath("/[locale]/provider/vehicles/[id]", "page");
}

export async function analyzeRegistrationAction(vehicleId: string): Promise<RegistrationAnalysisResult> {
  try {
    const result = await runRegistrationAnalysis(vehicleId);
    if (result.ok) revalidateDetail();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

async function write(mode: "DRAFT" | "SUBMIT", vehicleId: string, values: Record<string, unknown>): Promise<RegistrationReviewResult> {
  try {
    const result = await writeRegistrationConfirmation(mode, vehicleId, values);
    if (result.ok) revalidateDetail();
    return result;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

export async function saveRegistrationDraftAction(vehicleId: string, values: Record<string, unknown>): Promise<RegistrationReviewResult> {
  return write("DRAFT", vehicleId, values);
}

export async function submitRegistrationConfirmationAction(vehicleId: string, values: Record<string, unknown>): Promise<RegistrationReviewResult> {
  return write("SUBMIT", vehicleId, values);
}
