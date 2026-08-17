"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { assertAssignableCategory } from "@/lib/categories/assert-assignable-category";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { notifyProviderOfEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";

// Gate B4 — Admin grants an ADDITIONAL activity to a provider. This is the ONLY
// way a provider acquires an activity beyond their one self-selected primary.
// Provenance is 100% server-derived (source=ADMIN, isPrimary=false, grantedByAdminId
// = the authenticated admin, grantedAt=now) — never accepted from the client. It
// NEVER rewrites an existing SELF/LEGACY/ADMIN link's provenance (idempotent), and
// can NEVER create a primary. Audited; the provider is notified post-commit.

export type GrantProviderActivityResult =
  | { ok: true }
  | { ok: false; error: "INVALID_INPUT" | "NO_ADMIN_PROFILE" | "PROVIDER_NOT_FOUND" | "INVALID_CATEGORY" | "UNKNOWN_ERROR" };

export async function grantProviderActivity(providerId: string, categoryId: string): Promise<GrantProviderActivityResult> {
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

    // Same shared taxonomy eligibility rule the provider/service pickers use.
    if (!(await assertAssignableCategory(categoryId, DEFAULT_SERVICE_TYPE_KEY))) {
      return { ok: false, error: "INVALID_CATEGORY" };
    }

    // Idempotent: an already-linked category (of ANY provenance) is already
    // authorized — never rewrite SELF/LEGACY/ADMIN provenance; create ONLY when absent.
    const existing = await prisma.providerCategory.findUnique({
      where: { providerId_categoryId: { providerId, categoryId } },
      select: { source: true },
    });

    let created = false;
    if (!existing) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.providerCategory.create({
            data: {
              providerId,
              categoryId,
              source: "ADMIN",
              isPrimary: false,
              grantedByAdminId: admin.id,
              grantedAt: new Date(),
            },
          });
          await recordAuditEvent(
            {
              actorType: "ADMIN",
              actorId: admin.id,
              action: "provider.activity_granted",
              entityType: "Provider",
              entityId: providerId,
              newValue: { categoryId, source: "ADMIN" },
            },
            tx
          );
        });
        created = true;
      } catch (error) {
        // Concurrency: a racing grant already inserted the composite PK — idempotent.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          created = false;
        } else {
          throw error;
        }
      }
    }

    revalidatePath(`/admin/providers/${providerId}`);

    if (created) {
      // Post-commit, fire-and-forget — a notification failure never fails the grant.
      try {
        await notifyProviderOfEvent(PROVIDER_NOTIFICATION_EVENT.ACTIVITY_GRANTED, {
          providerUserId: provider.userId,
          providerId,
        });
      } catch (notifyError) {
        logger.error("grantProviderActivity.notification_failed", {
          providerId,
          message: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    }

    return { ok: true };
  } catch (error) {
    logger.error("grantProviderActivity.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
