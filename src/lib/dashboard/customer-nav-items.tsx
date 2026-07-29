import { CalendarCheck, Bell, Heart, Settings, Compass, Star, Briefcase, ShieldCheck, CreditCard } from "lucide-react";
import { getPathname } from "@/i18n/navigation";
import type { AppNavItem } from "@/components/app-shell/app-shell";
import type { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { Locale } from "@/i18n/locales";

type DashboardTranslator = Awaited<ReturnType<typeof getServerTranslator<"dashboard">>>;

// Customer Experience Platform — options for the two contextual items
// that only ever appeared on the Dashboard page's own separate inline
// nav array before this phase. This helper NEVER calls
// hasActiveAdminProfile() or any other RBAC check itself — both flags
// must be an already-resolved value the caller computed (the Dashboard
// page already calls hasActiveAdminProfile() itself, exactly as
// before); this helper only renders based on what it's told, never
// re-derives authorization.
export type CustomerNavOptions = {
  showBecomeProvider?: boolean;
  isAdmin?: boolean;
};

// Shared Customer nav item builder — Phase C.3 Group 3, extended by the
// Customer Experience Platform.
//
// Extracted from src/app/[locale]/dashboard/page.tsx's own inline
// array so the identical nav can be composed on every Customer page.
// Saved/Settings remain visible but non-interactive (no href, no route
// invented) — now with a real, localized `disabledHint` ("Coming
// soon") instead of being silently inert, per this phase's own
// "preserve keyboard and screen-reader clarity for disabled items"
// requirement.
//
// REVIEWS ROUTE — real destination, unconditional: the new /reviews
// page (Awaiting Review + Reviews Given) is a real feature every
// Customer page should link to, so it's part of the base array, not
// gated behind `options`.
//
// Phase D.1 — REAL NOTIFICATIONS LINK + BADGE: the Notifications item
// has a real href and a real `badge` — the caller fetches
// getUnreadCount() itself (it already needs to, for AppShell's
// unreadNotificationsCount prop) and passes it in here rather than
// this helper fetching it independently a second time.
//
// SCOPE NOTE (Customer Experience Platform): `options` is consumed
// today only by the Dashboard page (the one place this phase was asked
// to consolidate) — Bookings/Notifications/Booking Detail/Reviews
// pages call this helper without `options`, so they render the same
// 6-item base set they always have (Overview/Bookings/Reviews/
// Notifications/Saved/Settings). Retrofitting Become-Provider/Admin-
// Panel onto every other Customer page was explicitly out of this
// phase's scope — only the Dashboard page's own pre-existing behavior
// is being consolidated, not expanded elsewhere.
export function getCustomerNavItems(
  t: DashboardTranslator,
  locale: Locale,
  unreadNotificationsCount: number,
  options: CustomerNavOptions = {}
): AppNavItem[] {
  const items: AppNavItem[] = [
    { label: t("navOverview"), href: getPathname({ href: "/dashboard", locale }), icon: <Compass size={18} strokeWidth={1.75} /> },
    { label: t("navBookings"), href: getPathname({ href: "/bookings", locale }), icon: <CalendarCheck size={18} strokeWidth={1.75} /> },
    { label: t("navPayments"), href: getPathname({ href: "/payments", locale }), icon: <CreditCard size={18} strokeWidth={1.75} /> },
    { label: t("navReviews"), href: getPathname({ href: "/reviews", locale }), icon: <Star size={18} strokeWidth={1.75} /> },
    {
      label: t("navNotifications"),
      href: getPathname({ href: "/notifications", locale }),
      icon: <Bell size={18} strokeWidth={1.75} />,
      badge: unreadNotificationsCount,
    },
    { label: t("navSaved"), icon: <Heart size={18} strokeWidth={1.75} />, disabledHint: t("comingSoonLabel") },
    { label: t("navSettings"), icon: <Settings size={18} strokeWidth={1.75} />, disabledHint: t("comingSoonLabel") },
  ];

  if (options.showBecomeProvider) {
    items.push({
      label: t("navBecomeProvider"),
      href: getPathname({ href: "/provider-application", locale }),
      icon: <Briefcase size={18} strokeWidth={1.75} />,
    });
  }

  if (options.isAdmin) {
    items.push({
      label: t("navAdminPanel"),
      href: getPathname({ href: "/admin", locale }),
      icon: <ShieldCheck size={18} strokeWidth={1.75} />,
    });
  }

  return items;
}
