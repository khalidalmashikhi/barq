import "server-only";
import type { Admin, Staff, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAuth } from "./rbac";
import { ForbiddenError } from "./errors";
import {
  type PermissionKey,
  PERMISSION_KEYS,
  isPermissionKey,
  sanitizePermissionKeys,
  modulesForPermissions,
} from "./permissions";

// STAFF RBAC (Gate Z-3) — the ONE canonical server-side authorization authority for
// internal (Admin/Staff) capabilities. Composes requireAuth() (which owns the session +
// the SUSPENDED/DEACTIVATED user denylist) and never re-implements it.
//
// Authority model (owner-approved):
//   • OWNER  (Admin.level=OWNER, ACTIVE) → ALL permissions + owner-only administration.
//   • ADMIN  (Admin.level=ADMIN, ACTIVE) → COMPATIBILITY: all DOMAIN permissions, but NOT
//       owner-only administration. This is a documented compatibility boundary for the
//       legacy Admin account class; new operational employees are STAFF, not ADMIN.
//   • STAFF  (ACTIVE)                     → ONLY the keys in Staff.permissions.
//   • STAFF DEACTIVATED / CUSTOMER / PROVIDER / no internal row → NO internal access.
//
// Permissions are resolved from the DB on EVERY protected request (never trusted from
// client/session state), so a grant/removal takes effect on the actor's next request.

export type InternalActor =
  | { kind: "ADMIN"; isOwner: boolean; admin: Admin; staff: null; actorType: "ADMIN"; actorId: string; permissions: "ALL" }
  | { kind: "STAFF"; isOwner: false; admin: null; staff: Staff; actorType: "STAFF"; actorId: string; permissions: Set<PermissionKey> };

/** A single canonical, non-enumerating forbidden error for every internal denial. */
function internalForbidden(): never {
  throw new ForbiddenError("Internal access required", "INTERNAL_FORBIDDEN");
}

/**
 * Resolve the internal actor for an authenticated BARQ user, or null if the user is not
 * an ACTIVE Admin or ACTIVE Staff. Never throws for a non-internal user (returns null) —
 * so it can back both the throwing guards below and non-throwing nav/API reads.
 */
export async function resolveInternalActor(barqUser: User): Promise<InternalActor | null> {
  const [admin, staff] = await Promise.all([
    prisma.admin.findUnique({ where: { userId: barqUser.id } }),
    prisma.staff.findUnique({ where: { userId: barqUser.id } }),
  ]);

  // Admin precedence (matches effective-account-type): an ACTIVE Admin is an internal
  // actor with full domain authority regardless of any Staff row.
  if (admin && admin.status === "ACTIVE") {
    return {
      kind: "ADMIN",
      isOwner: admin.level === "OWNER",
      admin,
      staff: null,
      actorType: "ADMIN",
      actorId: admin.id,
      permissions: "ALL",
    };
  }

  if (staff && staff.status === "ACTIVE") {
    return {
      kind: "STAFF",
      isOwner: false,
      admin: null,
      staff,
      actorType: "STAFF",
      actorId: staff.id,
      permissions: new Set(sanitizePermissionKeys(staff.permissions)),
    };
  }

  return null;
}

function actorHasPermission(actor: InternalActor, permission: PermissionKey): boolean {
  return actor.permissions === "ALL" || actor.permissions.has(permission);
}

/**
 * Require an authenticated internal actor (Admin/Staff) holding `permission`. Throws the
 * canonical INTERNAL_FORBIDDEN for a missing session-derived internal row, a deactivated
 * one, or a staff member lacking the permission. Returns the resolved actor so callers
 * can attribute writes/audit correctly (actorType/actorId; admin is null for staff).
 */
export async function requirePermission(permission: PermissionKey): Promise<{ barqUser: User; actor: InternalActor }> {
  const { barqUser } = await requireAuth();
  const actor = await resolveInternalActor(barqUser);
  if (!actor) {
    logger.warn("auth.internal_forbidden", { userId: barqUser.id, requiredPermission: permission });
    internalForbidden();
  }
  if (!actorHasPermission(actor, permission)) {
    logger.warn("auth.permission_denied", { userId: barqUser.id, requiredPermission: permission, actorType: actor.actorType });
    internalForbidden();
  }
  return { barqUser, actor };
}

/**
 * Require ANY authenticated internal actor (ACTIVE Admin/OWNER or ACTIVE Staff), with NO
 * specific permission. For the shared internal shell/layout so a legitimate Staff member
 * can enter — every page/action/API BELOW it still enforces its own requirePermission(key).
 * Customers/providers and deactivated internal accounts are denied.
 */
export async function requireInternal(): Promise<{ barqUser: User; actor: InternalActor }> {
  const { barqUser } = await requireAuth();
  const actor = await resolveInternalActor(barqUser);
  if (!actor) {
    logger.warn("auth.internal_forbidden", { userId: barqUser.id, requiredPermission: "<internal>" });
    internalForbidden();
  }
  return { barqUser, actor };
}

/**
 * Require the platform OWNER (Admin.level=OWNER, ACTIVE). The ONLY authority for staff/
 * admin/permission administration. A non-owner Admin, any Staff, or a customer/provider
 * is denied with the same canonical error (never revealing that owner power exists).
 */
export async function requireOwner(): Promise<{ barqUser: User; admin: Admin }> {
  const { barqUser } = await requireAuth();
  const actor = await resolveInternalActor(barqUser);
  if (!actor || actor.kind !== "ADMIN" || !actor.isOwner) {
    logger.warn("auth.owner_required", { userId: barqUser.id });
    internalForbidden();
  }
  return { barqUser, admin: actor.admin };
}

/**
 * The effective permission keys for a user (non-throwing): every key for an ACTIVE
 * Admin/OWNER, the granted subset for ACTIVE Staff, and [] for everyone else. For nav /
 * allowedModules / API self-reads — NEVER an authorization gate on its own.
 */
export async function getEffectivePermissions(barqUser: User): Promise<PermissionKey[]> {
  const actor = await resolveInternalActor(barqUser);
  if (!actor) return [];
  if (actor.permissions === "ALL") return [...PERMISSION_KEYS];
  return PERMISSION_KEYS.filter((k) => (actor.permissions as Set<PermissionKey>).has(k));
}

export async function hasPermission(barqUser: User, permission: PermissionKey): Promise<boolean> {
  if (!isPermissionKey(permission)) return false;
  const actor = await resolveInternalActor(barqUser);
  return actor !== null && actorHasPermission(actor, permission);
}

/** The distinct internal modules the user may access (for permission-driven nav). */
export async function getAllowedModules(barqUser: User): Promise<string[]> {
  return modulesForPermissions(await getEffectivePermissions(barqUser));
}
