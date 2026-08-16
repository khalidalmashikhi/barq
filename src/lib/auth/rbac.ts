import "server-only";
import { getSession } from "./session";
import { resolveBarqUser } from "./barq-user";
import { UnauthenticatedError, ForbiddenError } from "./errors";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { User, StaffRole, Provider } from "@prisma/client";

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

// Phase C.2 (Authentication & Security) — interim, server-side-only
// visibility into every authorization failure in the app: every
// protected page, Server Action, and API route ultimately calls
// through one of the require*() functions below, so logging here
// (rather than at each of their many call sites) gives complete
// coverage from one place, consistent with this file's own existing
// Composition over Duplication rule. No PII beyond the already-opaque
// BARQ User id (never phone number/name). This is NOT a replacement
// for the persistent, schema-backed Audit Log that ADR-0006 and
// DATABASE_DESIGN.md §3/§9 already call for — that requires a new
// Prisma model and is out of this phase's scope ("do not change
// Prisma schema unless absolutely required"); this is the narrow,
// low-risk interim step of making failures visible in server logs
// (picked up by whatever the deployment platform/Sentry already
// captures) until that real Audit Log exists.
//
// Phase D.3 — STRUCTURED LOGGING: these calls now go through
// src/lib/logger.ts instead of a free-form console.warn template
// string, so every authorization-failure log line has the same
// {timestamp, level, message, ...context} shape as every other log
// line in the app. The context passed (userId, role) is unchanged from
// before — still never phone number/name, just restructured.

/**
 * Requires a valid session and a resolved BARQ User. Throws
 * UnauthenticatedError (-> HTTP 401) if no session exists. This is the
 * single foundation every other require*() helper builds on.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getSession();

  if (!session) {
    logger.warn("auth.unauthenticated_access_attempt");
    throw new UnauthenticatedError();
  }

  const barqUser = await resolveBarqUser(session.user.id);

  // User & Access Management (Batch 1) — real status-based authorization.
  // A punitively terminated account (SUSPENDED/DEACTIVATED) keeps a valid
  // Better Auth session until it expires, so authentication alone is not
  // enough — this is the single choke point every require*() helper builds
  // on, so denying here revokes access to every page, Server Action, and API
  // for such a user in one place. Deliberately a DENYLIST (only the two
  // terminal statuses), never an allowlist: CREATED/VERIFIED/ACTIVE all pass,
  // so normal freshly-signed-in users (default status CREATED) are unaffected.
  // Does NOT touch Better Auth or the authentication flow — a post-auth
  // authorization check only.
  if (barqUser.status === "SUSPENDED" || barqUser.status === "DEACTIVATED") {
    logger.warn("auth.forbidden", {
      userId: barqUser.id,
      reason: "user_status",
      currentUserStatus: barqUser.status,
    });
    throw new ForbiddenError("Account is not active", "USER_INACTIVE");
  }

  return { authUserId: session.user.id, barqUser };
}

/**
 * Requires an authenticated Customer. Throws UnauthenticatedError (401)
 * if not signed in, ForbiddenError (403) if signed in but not a Customer.
 */
export async function requireCustomer() {
  const { barqUser } = await requireAuth();

  // Gate A: an ACTIVE Admin is backoffice-only and cannot act as a Customer.
  await assertNotActiveAdmin(barqUser.id);

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) {
    logger.warn("auth.forbidden", { userId: barqUser.id, requiredRole: "Customer" });
    throw new ForbiddenError("Customer role required");
  }

  return { barqUser, customer };
}

/**
 * Resolves the caller's own Provider row and classifies it against the
 * exact same status gate requireProvider() enforces (DEACTIVATED/
 * SUSPENDED are the terminal, punitive statuses that revoke access) —
 * but never throws. This is the single, canonical place that status
 * gate is decided; requireProvider() below and any endpoint that needs
 * to treat "provider" as one of several *possible* roles for the same
 * request (e.g. a resource reachable by its owning Customer, owning
 * Provider, or an Admin) both build on this instead of re-deriving the
 * status check independently.
 *
 * Follow-up fix (Route Handler provider-deactivation gap): the
 * dedicated audit that verified requireProvider()'s own DEACTIVATED/
 * SUSPENDED rejection found two Route Handlers
 * (src/app/api/contracts/[id]/download/route.ts,
 * src/app/api/bookings/[id]/history/route.ts) resolved provider
 * identity via their own raw, unguarded `prisma.provider.findUnique()`
 * call instead of going through this file at all — meaning a
 * deactivated provider could still download a contract PDF or read a
 * booking's full status timeline for a booking they were the provider
 * on. Both routes now call this function instead of querying Prisma
 * directly, closing that gap without duplicating the status-check logic
 * a second time.
 */
export async function resolveProviderStatus(
  userId: string
): Promise<{ kind: "not_found" } | { kind: "inactive"; provider: Provider } | { kind: "active"; provider: Provider }> {
  const provider = await prisma.provider.findUnique({ where: { userId } });

  if (!provider) {
    return { kind: "not_found" };
  }

  if (provider.status === "DEACTIVATED" || provider.status === "SUSPENDED") {
    return { kind: "inactive", provider };
  }

  return { kind: "active", provider };
}

/**
 * Requires an authenticated Provider. Same 401/403 semantics as
 * requireCustomer above.
 *
 * Production Blocker fix: previously checked only that a Provider row
 * existed, never its `status` — meaning a DEACTIVATED (or, if ever
 * wired up, SUSPENDED) provider retained full operational access
 * (accept/reject/start/complete bookings, view payment data) for as
 * long as their session remained valid, since this is the actual gate
 * every one of those actions calls. Every existing call site already
 * catches `ForbiddenError` uniformly (see accept-booking.ts et al.) and
 * maps it to the same "no usable provider profile" outcome it already
 * returns for a provider row that doesn't exist at all — which is
 * exactly the right behavior here too, so no call site needed to
 * change. `requireApprovedProvider()` below still separately enforces
 * `status === "APPROVED"` for service/availability management — this
 * check is deliberately narrower (only the terminal, punitive statuses)
 * so an APPLIED/UNDER_REVIEW/REJECTED provider's read-only dashboard
 * access is unaffected, matching this function's pre-existing scope.
 *
 * Now implemented on top of resolveProviderStatus() above — same
 * status classification, just converted into a throw here instead of a
 * discriminated return value.
 */
export async function requireProvider() {
  const { barqUser } = await requireAuth();

  // Gate A: an ACTIVE Admin is backoffice-only and cannot act as a Provider.
  // requireApprovedProvider() composes this, so it inherits the exclusion.
  await assertNotActiveAdmin(barqUser.id);

  const lookup = await resolveProviderStatus(barqUser.id);

  if (lookup.kind === "not_found") {
    logger.warn("auth.forbidden", { userId: barqUser.id, requiredRole: "Provider" });
    throw new ForbiddenError("Provider role required");
  }

  if (lookup.kind === "inactive") {
    logger.warn("auth.forbidden", {
      userId: barqUser.id,
      requiredRole: "Provider",
      currentProviderStatus: lookup.provider.status,
    });
    throw new ForbiddenError("Provider account is deactivated", "PROVIDER_DEACTIVATED");
  }

  return { barqUser, provider: lookup.provider };
}

/**
 * Requires an authenticated Provider whose `status` is APPROVED.
 * Composes requireProvider() (no duplicated session/DB-lookup logic —
 * ARCHITECTURE_PRINCIPLES.md Principle 18, Composition over
 * Duplication) and adds one further check on top.
 *
 * Phase 0 (Foundation Hardening) — BR-001 in
 * docs/project-memory/16-BUSINESS-RULES.md previously documented this
 * as a rule that "should" hold but didn't: requireProvider() alone
 * only confirms a Provider row exists, not that it's been approved, so
 * a provider in APPLIED/UNDER_REVIEW/REJECTED/SUSPENDED could create,
 * edit, and publish services. This closes that gap for exactly the
 * service/availability-management actions that need it — NOT for
 * requireProvider() itself, so booking actions (accept/reject/start/
 * complete-booking.ts) and read-only provider dashboard queries are
 * completely unaffected; changing requireProvider() globally would
 * have been a much larger, unrequested behavior change for flows this
 * task never named.
 *
 * Throws the same ForbiddenError as requireProvider() (401/403
 * semantics unchanged) but with `code: "PROVIDER_NOT_APPROVED"` so a
 * call site can return a distinct, honest error code instead of
 * conflating "no provider profile at all" with "provider exists but
 * isn't approved yet" — two meaningfully different situations for a
 * provider to see explained back to them.
 */
export async function requireApprovedProvider() {
  const { barqUser, provider } = await requireProvider();

  if (provider.status !== "APPROVED") {
    logger.warn("auth.forbidden", {
      userId: barqUser.id,
      requiredRole: "Provider",
      requiredProviderStatus: "APPROVED",
      currentProviderStatus: provider.status,
    });
    throw new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED");
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

  // User & Access Management (Batch 1) — a DEACTIVATED Staff member must lose
  // access, mirroring the Admin rule above. Existing ForbiddenError semantics
  // preserved.
  if (!staff || staff.status !== "ACTIVE") {
    logger.warn("auth.forbidden", { userId: barqUser.id, requiredRole: "Staff", currentStaffStatus: staff?.status });
    throw new ForbiddenError("Staff role required");
  }

  if (role && !staff.roles.includes(role)) {
    logger.warn("auth.forbidden", { userId: barqUser.id, requiredRole: "Staff", requiredStaffRole: role });
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

  // User & Access Management (Batch 1) — a DEACTIVATED Admin must lose access,
  // not merely be flagged. Previously this checked only existence, so
  // deactivation (Admin.status) had no effect on the actual gate. Now aligned
  // with hasActiveAdminProfile()'s existing status===ACTIVE rule. The thrown
  // ForbiddenError is unchanged, so every existing call site (which catches it
  // generically) behaves exactly as before for a non-active admin.
  if (!admin || admin.status !== "ACTIVE") {
    logger.warn("auth.forbidden", {
      userId: barqUser.id,
      requiredRole: "Admin",
      currentAdminStatus: admin?.status,
    });
    throw new ForbiddenError("Admin role required");
  }

  return { barqUser, admin };
}

/**
 * UX remediation (Admin navigation entry) — a non-throwing companion to
 * requireAdmin(), for the one legitimate case that isn't an
 * authorization gate: deciding whether to SHOW an "Admin Panel" nav
 * item to an already-authenticated user. requireAdmin() itself remains
 * the one and only enforcement mechanism for actual admin routes/
 * actions — this function never replaces it, and every real /admin/*
 * page still calls requireAdmin() independently (see admin/layout.tsx),
 * so a false positive here could at most reveal a nav link, never grant
 * access. Returns false (not a thrown error) for every other case —
 * no session, no BARQ User, no Admin row, or a DEACTIVATED one — since
 * "should this link be visible" is a plain boolean UI decision, not an
 * authorization failure to log or convert to an HTTP status.
 */
export async function hasActiveAdminProfile(barqUserId: string): Promise<boolean> {
  const admin = await prisma.admin.findUnique({ where: { userId: barqUserId } });
  // Null-safe by design: no Admin row (null) — and, defensively, any absent
  // value — is simply "not an active admin". Now that requireCustomer()/
  // requireProvider() call this on every request via assertNotActiveAdmin(), it
  // must never throw for a non-admin user.
  return admin?.status === "ACTIVE";
}

/**
 * Backoffice-only invariant (Admin Backoffice Hardening — Gate A). An ACTIVE
 * Admin account is administrative-only: it must NOT exercise Customer or Provider
 * PRODUCT capabilities, even if the same User historically holds Customer/Provider
 * rows. This is the single, reusable authorization authority — baked into
 * requireCustomer()/requireProvider() AND called explicitly at the raw-prisma
 * entry points that bypass those helpers (applyAsProvider, update-customer-settings,
 * and the customer-capability reads). It deletes nothing; it only removes authority.
 *
 * Throws the SAME ForbiddenError every require-helper / mutation catch already handles, so
 * callers map it to their generic NO_CUSTOMER_PROFILE / NO_PROVIDER_PROFILE outcome
 * WITHOUT revealing that a hidden Admin row exists. A non-admin, or an INACTIVE
 * (DEACTIVATED) Admin, is never blocked here — normal Customer/Provider (and
 * Customer+Provider coexistence) is unchanged for every non-active-admin user.
 */
export async function assertNotActiveAdmin(barqUserId: string): Promise<void> {
  if (await hasActiveAdminProfile(barqUserId)) {
    logger.warn("auth.admin_backoffice_only", { userId: barqUserId });
    throw new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY");
  }
}

/**
 * Non-throwing, session-level companion to assertNotActiveAdmin(): is the
 * CURRENTLY authenticated user an ACTIVE Admin? Used ONLY for role-aware PAGE
 * routing — redirecting an active admin away from the Customer/Provider pages
 * to /admin — which is a UX decision, never the authorization gate. Every
 * guarded action still calls assertNotActiveAdmin()/requireCustomer()/
 * requireProvider() independently, so a false negative here can only ever fail
 * to redirect a link; it can never grant a capability. Resolves the Admin row
 * through hasActiveAdminProfile() (no duplicated admin-detection) and returns
 * false for no session or any unlinked/non-active-admin user. Deliberately
 * does NOT create a BARQ User (unlike requireAuth's resolveBarqUser) — a pure
 * lookup with no side effects.
 */
export async function isActiveAdminSession(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const linked = await prisma.user.findUnique({
    where: { authUserId: session.user.id },
    select: { id: true },
  });
  if (!linked) return false;
  return hasActiveAdminProfile(linked.id);
}

/**
 * Non-throwing companion to requireApprovedProvider(), used ONLY to decide
 * whether to show the "Provider workspace" nav link to a user who is already an
 * APPROVED provider (the customer dashboard is every user's post-login landing,
 * so without this an approved provider has no discoverable path into /provider).
 * Exactly like hasActiveAdminProfile(): a false positive could at most reveal a
 * nav link — every /provider/* route still enforces its own requireProvider()/
 * requireApprovedProvider() gate independently. Returns false for no session,
 * no Provider row, or any non-APPROVED status.
 */
export async function hasApprovedProviderProfile(barqUserId: string): Promise<boolean> {
  const provider = await prisma.provider.findUnique({
    where: { userId: barqUserId },
    select: { status: true },
  });
  return provider !== null && provider.status === "APPROVED";
}
