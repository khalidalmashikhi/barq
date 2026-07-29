"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Archive Provider — Phase 2 (Provider Foundation). Maps this phase's
// requested "Archive" capability onto the existing ProviderStatus
// enum's DEACTIVATED value (schema already defined APPLIED/
// UNDER_REVIEW/APPROVED/SUSPENDED/DEACTIVATED — see the lifecycle
// reasoning in this phase's report: the enum is kept unchanged, not
// renamed, since 10+ existing relations and enforcement code already
// depend on these exact values). Terminal, mirroring Category's
// ARCHIVED-is-terminal precedent: refuses if already DEACTIVATED.
// Does not touch approvedAt/approvedByAdminId — those remain as
// historical record of the original approval.

export type ArchiveProviderResult = { ok: true } | { ok: false; error: ProviderAdminActionErrorCode };

export async function archiveProvider(providerId: string): Promise<ArchiveProviderResult> {
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

    if (provider.status === "DEACTIVATED") {
      return { ok: false, error: "INVALID_STATUS_TRANSITION" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { status: "DEACTIVATED" } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.archived",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { status: provider.status },
          newValue: { status: "DEACTIVATED" },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("archiveProvider.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
