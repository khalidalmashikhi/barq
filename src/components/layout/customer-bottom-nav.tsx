"use client";

import { useEffect } from "react";
import { Home, Compass, CalendarCheck, Bell, CircleUser } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { buildBottomNavTabs, isCustomerBottomNavSurface, type BottomNavTabKey } from "./bottom-nav-tabs";

// Phase 3C — Slice A. THE single shared customer bottom navigation.
//
// Presentation only (server guards remain the authorization boundary). Mounted ONCE in
// [locale]/layout.tsx and route-gated here, so exactly one instance renders across every
// customer surface (public marketplace + authenticated customer app) and NONE on the provider
// portal, admin portal, or auth/role-selection screens. This replaces the former Navbar-only
// `BottomNav`, which was absent on the AppShell-based customer pages (bookings, notifications,
// account) — the root cause of the bar appearing on Explore/booking but vanishing on Bookings.
//
// `usePathname()` from @/i18n/navigation is locale-stripped, so route-gating + active-tab matching
// are locale-agnostic and RTL-correct. The bar is `lg:hidden` (desktop uses the header nav /
// sidebar); on mobile it is fixed to the viewport bottom and honors the iPhone safe-area inset.
// A body class (`has-customer-bottom-nav`) drives the page-content bottom padding (globals.css) so
// content is never hidden behind the fixed bar — added/removed only while the bar is shown.

const ICONS: Record<BottomNavTabKey, typeof Home> = {
  home: Home,
  explore: Compass,
  bookings: CalendarCheck,
  notifications: Bell,
  account: CircleUser,
};

export function CustomerBottomNav() {
  const t = useTranslations("landing");
  const pathname = usePathname();
  // EXPLICIT ALLOWLIST (bottom-nav-tabs.ts): render only on the known customer marketplace + account
  // surfaces; every other route — provider/admin/auth/onboarding, static pages, and unknown/404/error
  // routes — renders nothing, so the bar can never leak onto an unintended surface.
  const show = isCustomerBottomNavSurface(pathname);

  // Drive the page-content bottom padding only while the bar is actually shown, and clean up when
  // navigating to a non-customer surface or unmounting — so provider/admin pages get no stray padding.
  useEffect(() => {
    const cls = "has-customer-bottom-nav";
    if (show) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [show]);

  if (!show) return null;

  // Real destinations always; an anonymous tap on a protected tab is redirected to /login by the
  // destination route's own server-side requireAuth (no client auth state, no duplicated authz).
  const tabs = buildBottomNavTabs(true, pathname);

  return (
    <nav
      aria-label={t("nav.marketplaceNavLabel")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {tabs.map((tab) => {
          const Icon = ICONS[tab.key];
          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={tab.href}
                aria-current={tab.active ? "page" : undefined}
                // 44px min touch target; touch-manipulation + transparent tap highlight and a
                // hover gated to real hover-capable fine pointers prevent the iOS sticky-orange state.
                className={`flex min-h-[44px] flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  tab.active
                    ? "text-primary"
                    : "text-foreground/60 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
                }`}
              >
                <Icon size={20} strokeWidth={tab.active ? 2.25 : 1.75} aria-hidden />
                <span className="truncate">{t(`nav.${tab.key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
