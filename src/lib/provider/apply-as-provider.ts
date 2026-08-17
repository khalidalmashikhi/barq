"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError, ForbiddenError, assertNotActiveAdmin } from "@/lib/auth";
import { assertAssignableCategory } from "@/lib/categories/assert-assignable-category";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
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
// Gate 1A: a new self-service application is created as "DRAFT" — NOT submitted.
// The provider uploads/replaces/deletes required documents and then must
// EXPLICITLY submit (submitProviderVerification: DRAFT -> UNDER_REVIEW) before it
// enters the admin review queue. Uploading a document is NOT submission. (Legacy
// APPLIED providers and admin-created providers are unaffected — the pending
// queue still accepts APPLIED + UNDER_REVIEW.)
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
  // Areas of activity (Gap G-onboarding) — optional at apply; same multi-select,
  // same taxonomy, same ProviderCategory write as Provider Settings.
  const categoryIds = [
    ...new Set(
      formData
        .getAll("categoryIds")
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    ),
  ];
  // Gap D — INDIVIDUAL vs COMPANY; any value other than the explicit INDIVIDUAL
  // choice falls back to the safe COMPANY default.
  const providerType = formData.get("providerType") === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY";

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
    // Gate A: an ACTIVE Admin is backoffice-only — it may not BECOME a provider.
    // This flow uses requireAuth() (not requireProvider), so the exclusion is
    // enforced explicitly here (raw-prisma bypass). No Provider row is created.
    await assertNotActiveAdmin(barqUserId);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      // Active admin (backoffice-only): deny generically without revealing the
      // Admin row. (An admin is redirected to /admin before ever reaching this
      // form; this is the direct-call defense.)
      return { ok: false, error: "UNKNOWN_ERROR" };
    }
    throw error;
  }

  try {
    const existing = await prisma.provider.findUnique({ where: { userId: barqUserId } });

    if (existing) {
      return { ok: false, error: "ALREADY_HAS_PROVIDER_PROFILE" };
    }

    // Re-validate every submitted area against the shared eligibility rule
    // (effectively-PUBLIC + serviceType-compatible) before creating anything.
    for (const categoryId of categoryIds) {
      if (!(await assertAssignableCategory(categoryId, DEFAULT_SERVICE_TYPE_KEY))) {
        return { ok: false, error: "INVALID_INPUT" };
      }
    }

    await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.create({
        data: {
          userId: barqUserId,
          businessName: { ar: trimmedNameAr, en: trimmedNameEn },
          businessDescription:
            trimmedDescriptionAr || trimmedDescriptionEn
              ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
              : undefined,
          providerType,
          status: "DRAFT",
        },
      });

      if (categoryIds.length > 0) {
        // Gate B1: ProviderCategory.source is now a required, no-default column.
        // These are the provider's own self-selections, so source = SELF. This is
        // only the minimal write-compat glue for the required column — the
        // one-activity/isPrimary onboarding rule is the separate B4 rework, and
        // nothing reads source/isPrimary yet.
        await tx.providerCategory.createMany({
          data: categoryIds.map((categoryId) => ({ providerId: provider.id, categoryId, source: "SELF" as const })),
        });
      }
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
