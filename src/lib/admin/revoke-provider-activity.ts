"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { notifyProviderOfEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";

// Gate B4 — Admin revokes an ADMIN-granted additional activity. Deliberately
// narrow:
//   - source=SELF   → NOT_REVOCABLE (this generic action never removes the
//                     provider's primary activity).
//   - source=LEGACY → NOT_REVOCABLE (pre-provenance links need a separate,
//                     explicit administrative policy, never casual deletion).
//   - source=ADMIN  → revocable, BUT blocked (ACTIVITY_IN_USE) when any of the
//                     provider's services still uses that category — services are
//                     NEVER auto-deleted/re-categorised/unpublished here.
// The service-use check and the delete run in ONE transaction so a concurrent
// service creation cannot slip a service in between the check and the delete.

class ActivityInUse extends Error {}

export type RevokeProviderActivityResult =
  | { ok: true }
  | {
      ok: false;
      error: "INVALID_INPUT" | "NO_ADMIN_PROFILE" | "PROVIDER_NOT_FOUND" | "NOT_FOUND" | "NOT_REVOCABLE" | "ACTIVITY_IN_USE" | "UNKNOWN_ERROR";
    };

export async function revokeProviderActivity(providerId: string, categoryId: string): Promise<RevokeProviderActivityResult> {
  if (!isValidUuid(providerId) || !isValidUuid(categoryId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    ({ admin } = await requireAdmin());
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }

  try {
    const provider = await prisma.provider.findUnique({ where: { id: providerId }, select: { id: true, userId: true } });
    if (!provider) return { ok: false, error: "PROVIDER_NOT_FOUND" };

    const link = await prisma.providerCategory.findUnique({
      where: { providerId_categoryId: { providerId, categoryId } },
      select: { source: true },
    });
    if (!link) return { ok: false, error: "NOT_FOUND" };
    // Only an ADMIN-granted additional activity is revocable via this action.
    if (link.source !== "ADMIN") return { ok: false, error: "NOT_REVOCABLE" };

    try {
      await prisma.$transaction(async (tx) => {
        // Service safety — block if the provider still offers a service in this category.
        const inUse = await tx.service.count({ where: { providerId, categoryId } });
        if (inUse > 0) throw new ActivityInUse();

        await tx.providerCategory.delete({ where: { providerId_categoryId: { providerId, categoryId } } });
        await recordAuditEvent(
          {
            actorType: "ADMIN",
            actorId: admin.id,
            action: "provider.activity_revoked",
            entityType: "Provider",
            entityId: providerId,
            previousValue: { categoryId, source: "ADMIN" },
          },
          tx
        );
      });
    } catch (error) {
      if (error instanceof ActivityInUse) return { ok: false, error: "ACTIVITY_IN_USE" };
      throw error;
    }

    revalidatePath(`/admin/providers/${providerId}`);

    // Post-commit, fire-and-forget — a notification failure never fails the revoke.
    try {
      await notifyProviderOfEvent(PROVIDER_NOTIFICATION_EVENT.ACTIVITY_REVOKED, {
        providerUserId: provider.userId,
        providerId,
      });
    } catch (notifyError) {
      logger.error("revokeProviderActivity.notification_failed", {
        providerId,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }

    return { ok: true };
  } catch (error) {
    logger.error("revokeProviderActivity.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
