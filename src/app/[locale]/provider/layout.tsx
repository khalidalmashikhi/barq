import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { LayoutDashboard, Package, CalendarCheck, Clock, Bell, Settings, Wallet, CreditCard, UserRound, FileCheck2 } from "lucide-react";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { AppShell, type AppNavItem } from "@/components/app-shell/app-shell";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";

// Provider layout — Provider Dashboard Phase 1b.
//
// Owns ONLY authentication redirect, secure Provider gating, and
// AppShell composition, per explicit instruction — no business logic,
// no data fetching beyond the auth check itself.
//
// This is the trigger point flagged since Phase 1a: a shared layout is
// justified now that /provider has a second real route
// (/provider/services). Individual pages no longer perform their own
// auth-gate/AppShell wrapping — this is the single place that does,
// for the whole /provider/* route tree.
//
// DEFENSE IN DEPTH, NOT REDUNDANCY: this check does not replace each
// query module's own independent requireProvider() call (per the
// Security Hardening pass applied to getProviderOverview() and
// getProviderServices()) — this layout's check shapes the routing
// outcome (redirect vs. notFound); the query module's own check
// remains the real, independent security boundary regardless of what
// this layout does.
//
// "Do not expose the existence of the Provider Dashboard" (approved
// Phase 1a decision): ForbiddenError -> notFound(), never a "Provider
// account required" message — applies to every route under
// /provider/*, not just Overview.
//
// INTERNATIONALIZATION PHASE A.2: nav item labels and the role label
// now come from next-intl's "provider" namespace (via
// getServerTranslator — this is a Server Component) instead of
// strings.ts's flat t.provider* keys. Values are unchanged for ar/en
// (copied verbatim into messages/{ar,en}/provider.json). Routes,
// icons, and AppShell composition are byte-for-byte unchanged.
//
// PHASE B GROUP 4 — MOVED UNDER [locale]: this file previously lived
// at src/app/provider/layout.tsx, unreachable from any locale-prefixed
// URL. `redirect` now comes from src/i18n/navigation.ts, and every nav
// item's href is computed via getPathname(), for the same reason
// already established in Groups 1-3.

// Phase B Group 5 Closure — private, authenticated route tree:
// explicit noindex/nofollow as defense-in-depth alongside the
// requireProvider() gate below (not a replacement for it). Applies to
// the entire /provider/* subtree via Next.js's metadata inheritance —
// none of the 5 nested pages define their own `robots` field, so
// nothing overrides this. No canonical/hreflang.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ProviderLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  try {
    await requireProvider();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
    }
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }

  const t = await getServerTranslator("provider");
  const unreadNotificationsCount = await getUnreadCount();

  // Phase D.1 — REAL NOTIFICATIONS NAV ITEM: new item, this phase —
  // Provider never had one before. Same getUnreadCount() result feeds
  // both this item's badge and AppShell's unreadNotificationsCount
  // prop below, so AppTopBar's bell reuses it rather than running its
  // own duplicate query.
  const providerNavItems: AppNavItem[] = [
    { label: t("navOverview"), href: getPathname({ href: "/provider", locale }), icon: <LayoutDashboard size={18} strokeWidth={1.75} /> },
    { label: t("navServices"), href: getPathname({ href: "/provider/services", locale }), icon: <Package size={18} strokeWidth={1.75} /> },
    { label: t("navBookings"), href: getPathname({ href: "/provider/bookings", locale }), icon: <CalendarCheck size={18} strokeWidth={1.75} /> },
    { label: t("navEarnings"), href: getPathname({ href: "/provider/earnings", locale }), icon: <Wallet size={18} strokeWidth={1.75} /> },
    { label: t("navPayments"), href: getPathname({ href: "/provider/payments", locale }), icon: <CreditCard size={18} strokeWidth={1.75} /> },
    { label: t("navAvailability"), href: getPathname({ href: "/provider/availability", locale }), icon: <Clock size={18} strokeWidth={1.75} /> },
    {
      label: t("navNotifications"),
      href: getPathname({ href: "/provider/notifications", locale }),
      icon: <Bell size={18} strokeWidth={1.75} />,
      badge: unreadNotificationsCount,
    },
    { label: t("navVerification"), href: getPathname({ href: "/provider/verification", locale }), icon: <FileCheck2 size={18} strokeWidth={1.75} /> },
    { label: t("navSettings"), href: getPathname({ href: "/provider/settings", locale }), icon: <Settings size={18} strokeWidth={1.75} /> },
    // Customer → Provider Journey (return path) — the provider shell had no
    // way back to the customer side (the two shells are separate AppShell
    // trees). Every provider is also a customer (additive identity: the
    // Customer row is never removed on approval), so this single link makes
    // that dual identity navigable. NOT a mode switcher — just a link into
    // the customer dashboard, using the same nav-item pattern as every other
    // entry here.
    { label: t("navBackToCustomer"), href: getPathname({ href: "/dashboard", locale }), icon: <UserRound size={18} strokeWidth={1.75} /> },
  ];

  return (
    <AppShell
      navItems={providerNavItems}
      roleLabel={t("roleLabel")}
      notificationsHref={getPathname({ href: "/provider/notifications", locale })}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      {children}
    </AppShell>
  );
}
