"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import type { ProviderProfileActionErrorCode } from "./provider-profile-errors";

// Update Provider Profile (self-service) — Provider Operations
// Foundation.
//
// NO EXISTING PROVIDER-SCOPED UPDATE ACTION FOUND (confirmed by
// grepping "update-provider"/"updateProvider"/"update-provider-profile"
// before writing this file): the only existing updateProvider() lives
// in src/lib/admin/update-provider.ts, gated by requireAdmin() and
// recording an ADMIN-attributed audit event — using it from a Provider
// context would either 403 (a real Provider isn't an Admin) or, worse,
// mislabel the actor in the audit trail. This is a new, smaller,
// Provider-gated sibling, not a duplicate: same field set (minus
// `slug`, which affects public URL routing and stays admin-only) and
// the same validation shape as that file, but requireProvider() instead
// of requireAdmin(), and no audit event — mirroring update-service.ts's
// own convention, since no other provider-initiated mutation in this
// codebase records one either.
//
// FIELDS: only businessName/businessDescription/contactEmail/city/
// logoUrl — the exact set of Provider columns a provider is allowed to
// change themselves. `status`/`visible`/`approvedAt`/`approvedByAdminId`
// stay admin-only (the vetting/marketplace-visibility workflow), and
// `slug` stays admin-only (see above) — no new schema fields, no new
// provider capability beyond "edit your own already-existing business
// info."
//
// GATE: requireProvider(), not requireApprovedProvider() — editing your
// own basic business info isn't a service/availability create-edit-
// publish action (the only category requireApprovedProvider() is
// deliberately scoped to, per rbac.ts's own comment), so a provider
// still in APPLIED/UNDER_REVIEW should be able to fix their own
// business info before an admin ever reviews it.

export type UpdateProviderProfileResult = { ok: true } | { ok: false; error: ProviderProfileActionErrorCode };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/\S+$/;

export async function updateProviderProfile(formData: FormData): Promise<UpdateProviderProfileResult> {
  const nameAr = formData.get("businessNameAr");
  const nameEn = formData.get("businessNameEn");
  const descriptionAr = formData.get("businessDescriptionAr");
  const descriptionEn = formData.get("businessDescriptionEn");
  const contactEmail = formData.get("contactEmail");
  const city = formData.get("city");

  if (
    typeof nameAr !== "string" ||
    typeof nameEn !== "string" ||
    typeof descriptionAr !== "string" ||
    typeof descriptionEn !== "string" ||
    typeof contactEmail !== "string" ||
    typeof city !== "string"
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();
  const trimmedDescriptionAr = descriptionAr.trim();
  const trimmedDescriptionEn = descriptionEn.trim();
  const trimmedEmail = contactEmail.trim();
  const trimmedCity = city.trim();

  if (!trimmedNameAr || !trimmedNameEn) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // logoUrl is now owned by the dedicated upload endpoint (Gap C —
  // /api/provider/media/logo). This form no longer submits it, so we must
  // NOT overwrite/clear it here. Only touch logoUrl if the field was
  // actually submitted (backward-compat for any caller that still sends it).
  let logoUrlPatch: { logoUrl: string | null } | undefined;
  if (formData.has("logoUrl")) {
    const logoUrl = formData.get("logoUrl");
    if (typeof logoUrl !== "string") {
      return { ok: false, error: "INVALID_INPUT" };
    }
    const trimmedLogoUrl = logoUrl.trim();
    if (trimmedLogoUrl && !URL_PATTERN.test(trimmedLogoUrl)) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    logoUrlPatch = { logoUrl: trimmedLogoUrl || null };
  }

  let provider;
  try {
    const auth = await requireProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  const newBusinessDescription =
    trimmedDescriptionAr || trimmedDescriptionEn ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn } : null;

  // Gap D — providerType is editable (a pure presentation discriminator: it
  // gates no services/bookings/categories/permissions, so switching is safe).
  // An unknown/absent value leaves the current type unchanged.
  const rawType = formData.get("providerType");
  const nextType = rawType === "INDIVIDUAL" || rawType === "COMPANY" ? rawType : provider.providerType;
  const typeChanged = nextType !== provider.providerType;

  const data: Prisma.ProviderUpdateInput = {
    businessName: { ar: trimmedNameAr, en: trimmedNameEn },
    businessDescription: newBusinessDescription ?? Prisma.DbNull,
    contactEmail: trimmedEmail || null,
    city: trimmedCity || null,
    ...logoUrlPatch,
    providerType: nextType,
  };

  try {
    if (typeChanged) {
      // Audit the type change atomically (BR-019); ordinary profile edits stay
      // unaudited, mirroring update-service.ts's convention.
      await prisma.$transaction(async (tx) => {
        await tx.provider.update({ where: { id: provider.id }, data });
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: provider.id,
            action: "provider.type_changed",
            entityType: "Provider",
            entityId: provider.id,
            previousValue: { providerType: provider.providerType },
            newValue: { providerType: nextType },
          },
          tx
        );
      });
    } else {
      await prisma.provider.update({ where: { id: provider.id }, data });
    }

    return { ok: true };
  } catch (error) {
    logger.error("updateProviderProfile.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
