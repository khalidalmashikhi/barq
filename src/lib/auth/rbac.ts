import "server-only";
import { getSession } from "./session";
import { resolveBarqUser } from "./barq-user";
import { UnauthenticatedError, ForbiddenError } from "./errors";
import { prisma } from "@/lib/db";
import type { User, StaffRole } from "@prisma/client";

// RBAC helpers — Engineering Sprint (RBAC).
//
// Server-side only (task #11) — the "server-only" import above causes a
// build-time error if any of this is ever accidentally imported into
// client-bundled code, rather than relying on convention alone.
//
// Every role-specific helper below is built on top of requireAuth() —
// none of them re-implement session lookup or BARQ User resolution
// independently (task #10, no duplicated authorization logic; also
// ARCHITECTURE_PRINCIPLES.md Principle 18, Composition over Duplication).
//
// Uses IDENTITY_AND_ACCESS.md §4's existing role model exactly — Customer,
// Provider, Staff (with its own multi-role StaffRole[]), Admin — via the
// relations DOMAIN_MODEL.md and PRISMA_SCHEMA.md already define on User.
// No new role concept is introduced here.

export type AuthContext = {
  authUserId: string;
  barqUser: User;
};

/**
 * Requires a valid session and a resolved BARQ User. Throws
 * UnauthenticatedError (-> HTTP 401) if no session exists. This is the
 * single foundation every other require*() helper builds on.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getSession();

  if (!session) {
    throw new UnauthenticatedError();
  }

  const barqUser = await resolveBarqUser(session.user.id);

  return { authUserId: session.user.id, barqUser };
}

/**
 * Requires an authenticated Customer. Throws UnauthenticatedError (401)
 * if not signed in, ForbiddenError (403) if signed in but not a Customer.
 */
export async function requireCustomer() {
  const { barqUser } = await requireAuth();

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) {
    throw new ForbiddenError("Customer role required");
  }

  return { barqUser, customer };
}

/**
 * Requires an authenticated Provider. Same 401/403 semantics as
 * requireCustomer above.
 */
export async function requireProvider() {
  const { barqUser } = await requireAuth();

  const provider = await prisma.provider.findUnique({
    where: { userId: barqUser.id },
  });

  if (!provider) {
    throw new ForbiddenError("Provider role required");
  }

  return { barqUser, provider };
}

/**
 * Requires an authenticated Staff member. Optionally requires a
 * specific StaffRole (Operations/Support/Finance, per
 * IDENTITY_AND_ACCESS.md §3 — one Staff member may hold more than one
 * role, hence the array-membership check rather than equality).
 * Passing no role requires only that the user is Staff in some capacity.
 */
export async function requireStaff(role?: StaffRole) {
  const { barqUser } = await requireAuth();

  const staff = await prisma.staff.findUnique({
    where: { userId: barqUser.id },
  });

  if (!staff) {
    throw new ForbiddenError("Staff role required");
  }

  if (role && !staff.roles.includes(role)) {
    throw new ForbiddenError(`Staff role '${role}' required`);
  }

  return { barqUser, staff };
}

/**
 * Requires an authenticated Admin. Same 401/403 semantics as
 * requireCustomer above.
 */
export async function requireAdmin() {
  const { barqUser } = await requireAuth();

  const admin = await prisma.admin.findUnique({
    where: { userId: barqUser.id },
  });

  if (!admin) {
    throw new ForbiddenError("Admin role required");
  }

  return { barqUser, admin };
}
