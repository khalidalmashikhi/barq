"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Create Provider (admin-initiated) — Phase 2 (Provider Foundation).
// Mirrors create-category.ts's shape. Distinct from the pre-existing
// self-service apply-as-provider.ts: that flow lets an already
// authenticated User apply for themselves; this one lets an Admin
// directly provision a Provider profile for an existing User (found by
// id) without that user needing to sign in and apply — e.g. onboarding
// a partner recruited outside the app. A new Provider always starts
// APPLIED (schema default), exactly like the self-service path — an
// admin directly creating the record is not itself an approval act;
// approveProvider() still gates publishing, per BR-001.

export type CreateProviderResult = { ok: true; providerId: string } | { ok: false; error: ProviderAdminActionErrorCode };

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/\S+$/;

export async function createProvider(formData: FormData): Promise<CreateProviderResult> {
  const userId = formData.get("userId");
  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const descriptionAr = formData.get("descriptionAr");
  const descriptionEn = formData.get("descriptionEn");
  const slug = formData.get("slug");
  const contactEmail = formData.get("contactEmail");
  const city = formData.get("city");
  const logoUrl = formData.get("logoUrl");

  if (
    typeof userId !== "string" ||
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

  if (!isValidUuid(userId)) {
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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return { ok: false, error: "USER_NOT_FOUND" };
    }

    const existingProvider = await prisma.provider.findUnique({ where: { userId } });
    if (existingProvider) {
      return { ok: false, error: "USER_ALREADY_HAS_PROVIDER_PROFILE" };
    }

    if (trimmedSlug) {
      const slugOwner = await prisma.provider.findUnique({ where: { slug: trimmedSlug } });
      if (slugOwner) {
        return { ok: false, error: "SLUG_TAKEN" };
      }
    }

    const providerId = await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.create({
        data: {
          userId,
          businessName: { ar: trimmedNameAr, en: trimmedNameEn },
          businessDescription: trimmedDescriptionAr || trimmedDescriptionEn ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn } : undefined,
          slug: trimmedSlug || undefined,
          contactEmail: trimmedEmail || undefined,
          city: trimmedCity || undefined,
          logoUrl: trimmedLogoUrl || undefined,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.created",
          entityType: "Provider",
          entityId: provider.id,
          newValue: {
            userId,
            businessName: { ar: trimmedNameAr, en: trimmedNameEn },
            status: "APPLIED",
          },
        },
        tx
      );

      return provider.id;
    });

    return { ok: true, providerId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes("slug")) {
        return { ok: false, error: "SLUG_TAKEN" };
      }
      return { ok: false, error: "USER_ALREADY_HAS_PROVIDER_PROFILE" };
    }
    logger.error("createProvider.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
