"use client";

import { Home, Compass, CalendarCheck, Bell, CircleUser } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { buildBottomNavTabs, type BottomNavTabKey } from "./bottom-nav-tabs";

// Mobile marketplace bottom navigation (Marketplace Foundation, Phase 1).
//
// PRESENTATION ONLY — server guards remain the authorization boundary. Rendered
// by the public Navbar (the marketing/marketplace surface); the authenticated
// AppShell tree (dashboard/provider/admin) keeps its own AppTopBar/AppSidebar,
// so there is never a second nav system on the same viewport.
//
// Capability logic is NOT duplicated here: the Account tab simply lands on
// /dashboard, where the existing doorways (become-provider / application-status /
// provider-workspace / admin) are already surfaced by customer-nav-items.tsx.
// For an anonymous visitor the protected tabs point at /login; the destination
// routes still enforce requireAuth server-side either way.
//
// `usePathname()` comes from @/i18n/navigation (locale-stripped), so active-state
// matching is locale-agnostic and RTL-correct. `lg:hidden` mirrors the Navbar's
// own desktop breakpoint (its inline nav is `lg:flex`).

const ICONS: Record<BottomNavTabKey, typeof Home> = {
  home: Home,
  explore: Compass,
  bookings: CalendarCheck,
  notifications: Bell,
  account: CircleUser,
};

export function BottomNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const t = useTranslations("landing");
  const pathname = usePathname();

  const tabs = buildBottomNavTabs(isAuthenticated, pathname);

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
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  tab.active ? "text-primary" : "text-foreground/55 hover:text-foreground"
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
