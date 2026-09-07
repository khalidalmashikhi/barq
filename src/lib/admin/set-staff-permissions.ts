"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  requireOwner,
  UnauthenticatedError,
  ForbiddenError,
  sanitizePermissionKeys,
  isStaffPresetName,
  presetPermissions,
} from "@/lib/auth";
import type { PermissionKey } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// STAFF RBAC (Gate Z-3) — the AUTHORITATIVE staff-permission editor. OWNER-only. This is
// the single writer of Staff.permissions (the runtime authorization authority). It never
// touches Staff.roles (legacy) and never elevates the caller. Setting an empty set is a
// valid operation (revokes all operational access — the safe zero-permission state).
//
// Input is either a preset name (expanded to its keys) or an explicit key list; both are
// sanitized to valid, de-duplicated, canonical-order keys before storage. An untrusted
// junk/invalid key is silently dropped (never stored), never an error.

export type SetStaffPermissionsErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "STAFF_NOT_FOUND"
  | "UNKNOWN_ERROR";

export type SetStaffPermissionsResult =
  | { ok: true; permissions: PermissionKey[] }
  | { ok: false; error: SetStaffPermissionsErrorCode };

type SetStaffPermissionsInput =
  | { preset: string }
  | { permissions: readonly unknown[] };

export async function setStaffPermissions(staffId: string, input: SetStaffPermissionsInput): Promise<SetStaffPermissionsResult> {
  if (!isValidUuid(staffId)) return { ok: false, error: "INVALID_INPUT" };

  // Resolve the requested permission set from a preset name OR an explicit list.
  let requested: PermissionKey[];
  if ("preset" in input) {
    if (!isStaffPresetName(input.preset)) return { ok: false, error: "INVALID_INPUT" };
    requested = presetPermissions(input.preset);
  } else if ("permissions" in input && Array.isArray(input.permissions)) {
    requested = sanitizePermissionKeys(input.permissions);
  } else {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // OWNER-only — the sole privilege administrator (prevents staff self-elevation).
  let actorAdmin;
  try {
    const auth = await requireOwner();
    actorAdmin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }

  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, permissions: true } });
    if (!staff) return { ok: false, error: "STAFF_NOT_FOUND" };

    const previous = sanitizePermissionKeys(staff.permissions);
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id: staffId }, data: { permissions: requested } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "preset" in input ? "staff.preset_applied" : "staff.permissions_changed",
          entityType: "Staff",
          entityId: staffId,
          previousValue: { permissions: previous },
          newValue: "preset" in input ? { preset: input.preset, permissions: requested } : { permissions: requested },
        },
        tx
      );
    });
    return { ok: true, permissions: requested };
  } catch (error) {
    logger.error("setStaffPermissions.unexpected_error", { staffId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
