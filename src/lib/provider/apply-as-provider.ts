"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { ProviderApplicationErrorCode } from "./provider-application-errors";

// Apply as Provider — Phase 5.1 (Production Readiness: self-service
// signup). Mirrors create-service.ts's shape: "use server", server-side
// re-validation of everything, a single $transaction-free create (no
// related row needs to be created atomically here), a stable
// ProviderApplicationErrorCode-style return.
//
// requireAuth(), NOT requireProvider() — applying is precisely how an
// authenticated User becomes a Provider, so a Provider profile must not
// be a precondition. requireAuth() never throws ForbiddenError (only
// requireCustomer/Provider/Staff/Admin do), so only UnauthenticatedError
// needs handling here.
//
// status is always created as "APPLIED" (the schema default, set
// explicitly for clarity) — this is the exact status
// get-pending-providers.ts already queries for, so a new application
// appears in the existing admin approval queue with zero changes to
// that queue or its page.
//
// No license/document/KYC field exists anywhere in the schema
// (confirmed during the Phase 5 audit) — businessName is the only
// required field beyond userId, so that is all this form collects.

export type ApplyAsProviderResult = { ok: true } | { ok: false; error: ProviderApplicationErrorCode };

export async function applyAsProvider(formData: FormData): Promise<ApplyAsProviderResult> {
  const businessNameAr = formData.get("businessNameAr");
  const businessNameEn = formData.get("businessNameEn");
  const businessDescriptionAr = formData.get("businessDescriptionAr");
  const businessDescriptionEn = formData.get("businessDescriptionEn");

  if (typeof businessNameAr !== "string" || typeof businessNameEn !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = businessNameAr.trim();
  const trimmedNameEn = businessNameEn.trim();

  if (!trimmedNameAr || !trimmedNameEn) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedDescriptionAr = typeof businessDescriptionAr === "string" ? businessDescriptionAr.trim() : "";
  const trimmedDescriptionEn = typeof businessDescriptionEn === "string" ? businessDescriptionEn.trim() : "";

  let barqUserId: string;
  try {
    const auth = await requireAuth();
    barqUserId = auth.barqUser.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    throw error;
  }

  try {
    const existing = await prisma.provider.findUnique({ where: { userId: barqUserId } });

    if (existing) {
      return { ok: false, error: "ALREADY_HAS_PROVIDER_PROFILE" };
    }

    await prisma.provider.create({
      data: {
        userId: barqUserId,
        businessName: { ar: trimmedNameAr, en: trimmedNameEn },
        businessDescription:
          trimmedDescriptionAr || trimmedDescriptionEn
            ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
            : undefined,
        status: "APPLIED",
      },
    });

    return { ok: true };
  } catch (error) {
    logger.error("applyAsProvider.unexpected_error", {
      barqUserId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
