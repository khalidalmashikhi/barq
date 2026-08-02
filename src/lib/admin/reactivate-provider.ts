"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Reactivate Provider — User & Access Management (Batch 5). The reverse of
// suspendProvider only: SUSPENDED -> APPROVED. It is deliberately NOT an
// "un-archive": DEACTIVATED is terminal by the existing design
// (archive-provider.ts's own documented rule), so a DEACTIVATED provider
// cannot be reactivated here — that would invent a transition the existing
// architecture rejects. Idempotent: an already-APPROVED provider is a no-op.

export type ReactivateProviderResult =
  | { ok: true; outcome: "reactivated" | "already_active" }
  | { ok: false; error: ProviderAdminActionErrorCode };

export async function reactivateProvider(providerId: string): Promise<ReactivateProviderResult> {
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
    if (provider.status === "APPROVED") return { ok: true, outcome: "already_active" };
    // Only a SUSPENDED provider can be reactivated. DEACTIVATED is terminal;
    // pre-approval statuses go through approveProvider, not here.
    if (provider.status !== "SUSPENDED") return { ok: false, error: "INVALID_STATUS_TRANSITION" };

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { status: "APPROVED" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.reactivated",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { status: provider.status },
          newValue: { status: "APPROVED" },
        },
        tx
      );
    });
    return { ok: true, outcome: "reactivated" };
  } catch (error) {
    logger.error("reactivateProvider.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
