"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import type { ServiceActionErrorCode } from "./service-action-errors";

// Edit Experience — Phase 4.2 (Provider Experience), Priority 1.
// Mirrors create-service.ts's validation and cancel-booking.ts's
// ownership-check shape. Only mutates name/description — status
// changes go through the separate transition-service-status.ts
// actions, and price changes are out of this phase's scope (Price is
// append-only/versioned in this schema; a real "edit price" flow would
// insert a new Price row, not mutate this one — a distinct future
// decision, not made here).

export type UpdateServiceResult = { ok: true } | { ok: false; error: ServiceActionErrorCode };

export async function updateService(serviceId: string, formData: FormData): Promise<UpdateServiceResult> {
  if (!isValidUuid(serviceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const descriptionAr = formData.get("descriptionAr");
  const descriptionEn = formData.get("descriptionEn");

  if (typeof nameAr !== "string" || typeof nameEn !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();

  if (!trimmedNameAr || !trimmedNameEn) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedDescriptionAr = typeof descriptionAr === "string" ? descriptionAr.trim() : "";
  const trimmedDescriptionEn = typeof descriptionEn === "string" ? descriptionEn.trim() : "";

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });

    if (!service || service.providerId !== provider.id) {
      return { ok: false, error: "SERVICE_NOT_FOUND" };
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: {
        name: { ar: trimmedNameAr, en: trimmedNameEn },
        description:
          trimmedDescriptionAr || trimmedDescriptionEn
            ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
            : undefined,
      },
    });

    return { ok: true };
  } catch (error) {
    logger.error("updateService.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
