import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth, hasActiveAdminProfile } from "@/lib/auth";
import type { CustomerNavOptions, ProviderDoorway } from "./customer-nav-items";

// Customer → Provider Journey (A) — the ONE shared resolver for the two
// contextual customer-shell nav flags (which provider doorway to show, and
// whether to show Admin Panel). Every authenticated customer page composes
// its nav via getCustomerNavItems(); before this, only /dashboard resolved
// these flags, so the "Become a Provider" / "Provider workspace" doorway
// silently vanished on every other customer page. Centralizing the lookup
// here (rather than repeating the provider/admin queries page-by-page) makes
// the doorway consistent across the whole customer shell from one place.
//
// ROLE-AGNOSTIC READER CALLS requireAuth() ITSELF, DELIBERATELY: this follows
// the exact pattern getUnreadCount()/getNotifications() already established —
// every customer page that renders this nav already calls getUnreadCount()
// (which calls requireAuth() internally), so this adds no new auth concept.
// It is a display resolver only and NEVER an authorization gate: a wrong
// flag can at most show/hide a nav link, and every /provider/* and /admin/*
// route still enforces its own requireProvider()/requireAdmin() gate
// independently (RBAC semantics are unchanged by this file).
//
// The provider status read here is intentionally the raw status (not
// resolveProviderStatus(), which collapses APPLIED/UNDER_REVIEW/APPROVED into
// a single "active") because the doorway needs to distinguish APPROVED
// (→ workspace) from a still-pending application (→ application status).

/**
 * Resolves the customer-shell nav options for the currently authenticated
 * user. Doorway mapping:
 *  - no Provider row                     → "become"       (→ /provider-application)
 *  - Provider APPROVED                   → "workspace"    (→ /provider)
 *  - Provider any other status           → "application"  (→ /provider-application)
 *    (APPLIED / UNDER_REVIEW / SUSPENDED / DEACTIVATED — the application page
 *    is the single source of truth for their current status.)
 *
 * Must be called after the page's own auth guard (like getUnreadCount()); it
 * throws UnauthenticatedError if there is no session.
 */
export async function resolveCustomerNavOptions(): Promise<CustomerNavOptions> {
  const { barqUser } = await requireAuth();

  const [provider, isAdmin] = await Promise.all([
    prisma.provider.findUnique({ where: { userId: barqUser.id }, select: { status: true } }),
    hasActiveAdminProfile(barqUser.id),
  ]);

  // Gate A (Admin Backoffice Hardening) — an ACTIVE Admin is backoffice-only:
  // it is never offered a "Become a Provider" / workspace / application doorway
  // into the customer→provider journey. (An active admin is also redirected away
  // from every customer page before this nav renders, so this is the display-layer
  // companion to that server-side redirect, never the enforcement itself.) The
  // Admin Panel entry is still surfaced via isAdmin.
  const providerDoorway: ProviderDoorway | undefined = isAdmin
    ? undefined
    : !provider
      ? "become"
      : provider.status === "APPROVED"
        ? "workspace"
        : "application";

  return { providerDoorway, isAdmin };
}
