"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Publish/Unpublish Provider — Phase 2 (Provider Foundation). Toggles
// the `visible` marketplace-display flag — independent of `status`
// (the approval/vetting workflow, unchanged). See this phase's report
// for the reasoning behind keeping these as two separate fields.
//
// publishProvider() enforces BR-001 (provider-approval enforcement,
// hardened in Phase 0.1): only an APPROVED provider may become visible.
// unpublishProvider() has no such restriction — hiding is always safe
// regardless of status.

export type ToggleProviderVisibilityResult = { ok: true } | { ok: false; error: ProviderAdminActionErrorCode };

async function setVisible(providerId: string, visible: boolean): Promise<ToggleProviderVisibilityResult> {
  if (!isValidUuid(providerId)) {
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

    if (visible && provider.status !== "APPROVED") {
      return { ok: false, error: "PROVIDER_NOT_APPROVED" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { visible } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: visible ? "provider.published" : "provider.unpublished",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { visible: provider.visible },
          newValue: { visible },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("toggleProviderVisibility.unexpected_error", {
      providerId,
      visible,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function publishProvider(providerId: string): Promise<ToggleProviderVisibilityResult> {
  return setVisible(providerId, true);
}

export async function unpublishProvider(providerId: string): Promise<ToggleProviderVisibilityResult> {
  return setVisible(providerId, false);
}
