"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Update Provider (admin-initiated) — Phase 2 (Provider Foundation).
// Mirrors update-category.ts's shape. Only mutates identity fields
// (businessName/businessDescription/slug/contactEmail/city/logoUrl) —
// never touches status/userId/approvedAt/approvedByAdminId (those go
// through approve-provider.ts / archive-provider.ts) or visible (goes
// through toggle-provider-visibility.ts), mirroring the same
// mutation/transition separation already established for
// Category/Service.

export type UpdateProviderResult = { ok: true } | { ok: false; error: ProviderAdminActionErrorCode };

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/\S+$/;

export async function updateProvider(providerId: string, formData: FormData): Promise<UpdateProviderResult> {
  if (!isValidUuid(providerId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const descriptionAr = formData.get("descriptionAr");
  const descriptionEn = formData.get("descriptionEn");
  const slug = formData.get("slug");
  const contactEmail = formData.get("contactEmail");
  const city = formData.get("city");
  const logoUrl = formData.get("logoUrl");

  if (
    typeof nameAr !== "string" ||
    typeof nameEn !== "string" ||
    typeof descriptionAr !== "string" ||
    typeof descriptionEn !== "string" ||
    typeof slug !== "string" ||
    typeof contactEmail !== "string" ||
    typeof city !== "string" ||
    typeof logoUrl !== "string"
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();
  const trimmedDescriptionAr = descriptionAr.trim();
  const trimmedDescriptionEn = descriptionEn.trim();
  const trimmedSlug = slug.trim().toLowerCase();
  const trimmedEmail = contactEmail.trim();
  const trimmedCity = city.trim();
  const trimmedLogoUrl = logoUrl.trim();

  if (!trimmedNameAr || !trimmedNameEn) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (trimmedSlug && !SLUG_PATTERN.test(trimmedSlug)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (trimmedLogoUrl && !URL_PATTERN.test(trimmedLogoUrl)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_ADMIN_PROFILE" };
    }
    throw error;
  }

  try {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });

    if (!provider) {
      return { ok: false, error: "PROVIDER_NOT_FOUND" };
    }

    if (trimmedSlug && trimmedSlug !== provider.slug) {
      const slugOwner = await prisma.provider.findUnique({ where: { slug: trimmedSlug } });
      if (slugOwner) {
        return { ok: false, error: "SLUG_TAKEN" };
      }
    }

    const newBusinessDescription =
      trimmedDescriptionAr || trimmedDescriptionEn ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn } : null;

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: {
          businessName: { ar: trimmedNameAr, en: trimmedNameEn },
          businessDescription: newBusinessDescription ?? Prisma.DbNull,
          slug: trimmedSlug || null,
          contactEmail: trimmedEmail || null,
          city: trimmedCity || null,
          logoUrl: trimmedLogoUrl || null,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.updated",
          entityType: "Provider",
          entityId: providerId,
          previousValue: {
            businessName: provider.businessName as object,
            slug: provider.slug,
          },
          newValue: {
            businessName: { ar: trimmedNameAr, en: trimmedNameEn },
            slug: trimmedSlug || null,
          },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    logger.error("updateProvider.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
