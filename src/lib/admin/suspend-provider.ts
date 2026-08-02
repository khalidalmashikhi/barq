"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Suspend Provider — User & Access Management (Batch 5). Fills in the
// previously-unwired ProviderStatus.SUSPENDED value with an explicit admin
// action: APPROVED -> SUSPENDED. Reuses the existing ProviderAdminActionErrorCode
// set (and its existing translation keys). Does NOT touch `visible` (visibility
// is an independent toggle — publish/unpublish), and does NOT touch User.status
// (Provider status and User access status are deliberately separate).
// Idempotent: an already-SUSPENDED provider is a no-op success.

export type SuspendProviderResult =
  | { ok: true; outcome: "suspended" | "already_suspended" }
  | { ok: false; error: ProviderAdminActionErrorCode };

export async function suspendProvider(providerId: string): Promise<SuspendProviderResult> {
  if (!isValidUuid(providerId)) return { ok: false, error: "INVALID_INPUT" };

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }

  try {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return { ok: false, error: "PROVIDER_NOT_FOUND" };
    if (provider.status === "SUSPENDED") return { ok: true, outcome: "already_suspended" };
    // Only an active (APPROVED) provider can be suspended — never a pre-approval
    // or already-terminal (DEACTIVATED) one.
    if (provider.status !== "APPROVED") return { ok: false, error: "INVALID_STATUS_TRANSITION" };

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { status: "SUSPENDED" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.suspended",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { status: provider.status },
          newValue: { status: "SUSPENDED" },
        },
        tx
      );
    });
    return { ok: true, outcome: "suspended" };
  } catch (error) {
    logger.error("suspendProvider.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
