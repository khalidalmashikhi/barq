import "server-only";
import { prisma } from "@/lib/db";
import { getSession } from "./session";

// EXCLUSIVE ACCOUNT TYPES — Gate Z-1. The single authoritative classification of a
// BARQ User's EFFECTIVE account type, derived from actual relational profile rows and
// their status, by the owner-approved precedence:
//
//   active Admin  >  active Staff  >  Provider (any status)  >  Customer  >  none
//
// "Effective type" is deliberately distinct from (a) the declared registration intent
// (a future User.accountType, deferred to Z-2 — no schema here) and (b) a profile's own
// operational status. A Provider in ANY lifecycle status (DRAFT..REJECTED, and even a
// DEACTIVATED provider) is still a PROVIDER *account type*; operational access is gated
// separately by requireProvider(). This module NEVER mutates or deletes a profile — it
// only reads and classifies. It uses no phone/email and trusts no client state.

export type EffectiveAccountType = "ADMIN" | "STAFF" | "PROVIDER" | "CUSTOMER" | "UNCLASSIFIED";

/**
 * The minimal presence/status snapshot the classification needs. A pure input so the
 * precedence itself is trivially unit-testable with no database.
 */
export type AccountProfileSnapshot = {
  /** An Admin row whose status is ACTIVE (matches hasActiveAdminProfile / requireAdmin). */
  hasActiveAdmin: boolean;
  /** A Staff row whose status is ACTIVE (matches requireStaff). */
  hasActiveStaff: boolean;
  /** A Provider row exists — ANY ProviderStatus (account type, not approval state). */
  hasProvider: boolean;
  /** A Customer row exists. */
  hasCustomer: boolean;
};

/**
 * Pure precedence. A deactivated/suspended Admin or Staff is NOT "active" and therefore
 * falls through to any Provider/Customer row the same User still holds — preserving the
 * existing suspension/deactivation semantics of the guards.
 */
export function classifyEffectiveAccountType(snapshot: AccountProfileSnapshot): EffectiveAccountType {
  if (snapshot.hasActiveAdmin) return "ADMIN";
  if (snapshot.hasActiveStaff) return "STAFF";
  if (snapshot.hasProvider) return "PROVIDER";
  if (snapshot.hasCustomer) return "CUSTOMER";
  return "UNCLASSIFIED";
}

/**
 * Authoritative server resolver for a known BARQ User id. Loads the four profile rows
 * (each unique by userId) and classifies. Read-only; never creates/mutates a profile.
 */
export async function resolveEffectiveAccountType(barqUserId: string): Promise<EffectiveAccountType> {
  const [admin, staff, provider, customer] = await Promise.all([
    prisma.admin.findUnique({ where: { userId: barqUserId }, select: { status: true } }),
    prisma.staff.findUnique({ where: { userId: barqUserId }, select: { status: true } }),
    prisma.provider.findUnique({ where: { userId: barqUserId }, select: { id: true } }),
    prisma.customer.findUnique({ where: { userId: barqUserId }, select: { id: true } }),
  ]);

  return classifyEffectiveAccountType({
    hasActiveAdmin: admin?.status === "ACTIVE",
    hasActiveStaff: staff?.status === "ACTIVE",
    hasProvider: provider !== null,
    hasCustomer: customer !== null,
  });
}

/**
 * Non-throwing, session-level resolver for ROUTING decisions only. Mirrors
 * isActiveAdminSession()'s non-creating lookup — it deliberately does NOT create a BARQ
 * User the way requireAuth()/resolveBarqUser() would. Returns null when there is no
 * session or no linked BARQ User yet (e.g. the very first request, before the bridge has
 * run), in which case the caller keeps the existing default landing.
 */
export async function resolveEffectiveAccountTypeForSession(): Promise<EffectiveAccountType | null> {
  const session = await getSession();
  if (!session) return null;
  const linked = await prisma.user.findUnique({
    where: { authUserId: session.user.id },
    select: { id: true },
  });
  if (!linked) return null;
  return resolveEffectiveAccountType(linked.id);
}

/**
 * The canonical home route for each effective account type. STAFF has no dedicated shell
 * yet (deferred to the Staff RBAC gate); the admin shell is its intended destination but
 * is requireAdmin-gated, so STAFF is NOT force-routed there today — the entry points
 * consult landingRedirectForEffectiveType() below, which leaves STAFF on the neutral
 * landing until that shell exists.
 */
export function routeForEffectiveAccountType(type: EffectiveAccountType): string {
  switch (type) {
    case "ADMIN":
      return "/admin";
    case "STAFF":
      return "/admin";
    case "PROVIDER":
      return "/provider";
    case "CUSTOMER":
      return "/dashboard";
    case "UNCLASSIFIED":
      return "/onboarding";
  }
}

/**
 * The divert target for an authenticated session that has LANDED on a generic entry
 * (/login or the /dashboard INDEX). Only ADMIN and PROVIDER are diverted to their own
 * home; everyone else — CUSTOMER, the not-yet-shelled STAFF, UNCLASSIFIED, or an
 * unresolved session — stays on the customer landing, where the existing customer-
 * completion gate still sends an incomplete/unclassified user onward to /onboarding.
 *
 * Deliberately scoped to the landing only: it does NOT divert a PROVIDER away from
 * /dashboard SUB-pages, so a legacy Customer+Provider user keeps read access to their
 * historical bookings under /dashboard/bookings (Gate Z-1 preserves historical reads).
 */
export function landingRedirectForEffectiveType(
  type: EffectiveAccountType | null
): "/admin" | "/provider" | null {
  if (type === "ADMIN") return "/admin";
  if (type === "PROVIDER") return "/provider";
  return null;
}
