import type { ReactNode } from "react";
import Link from "next/link";
import { Globe, MessageCircle } from "lucide-react";
import { getLocale } from "next-intl/server";
import { Logo } from "@/components/ui/logo";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotificationBell } from "./notification-bell";
import { AppMobileNav } from "./app-mobile-nav";
import type { AppNavItem } from "./app-sidebar";
import { formatDate } from "@/lib/i18n/format-date";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getPathname } from "@/i18n/navigation";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getNotifications } from "@/lib/notifications/get-notifications";

// AppTopBar — AppShell Migration (Stabilization).
//
// Generalized from the former, Customer-only src/components/dashboard/
// top-bar.tsx. The structural chrome (logo, date, language/messages
// icons — decorative/non-functional today, unchanged from before), and
// LogoutButton are role-agnostic and stay built in. The one genuinely
// Customer-specific piece — the "search for an experience" box — is
// NOT hardcoded here; it is passed in via the optional `centerContent`
// slot, so a future Provider/Admin top bar can supply its own center
// content (or none) without a separate ProviderTopBar component
// existing at all.
//
// Phase D.1 — REAL NOTIFICATION BELL: replaces the plain decorative
// bell button (itself already stripped of its fake, hardcoded unread
// dot in Phase C.3 Group 5) with the real NotificationBell Client
// Component. This Server Component fetches a short (5-item) preview
// here unconditionally (a Client Component cannot import server-only
// query modules directly) — the unread COUNT itself is only fetched
// here as a fallback: every current caller already runs its own
// getUnreadCount() to badge its own sidebar "Notifications" nav item,
// and passes that same number in via `unreadCount` so this component
// doesn't run a second, identical COUNT query on every page render.
// `notificationsHref` defaults to the Customer route ("/notifications")
// since every existing AppShell call site except Provider's own layout
// is Customer-facing; Provider's layout passes its own
// "/provider/notifications" path explicitly, exactly like it already
// does for its own nav item hrefs.
//
// No "use client" needed on this component itself — identical to
// before, all data fetching runs fine server-side; NotificationBell
// and LogoutButton are Client Components embedded as normal children,
// the standard, always-supported Server-renders-Client pattern.

type AppTopBarProps = {
  centerContent?: ReactNode;
  notificationsHref?: string;
  unreadCount?: number;
  navItems?: AppNavItem[];
  roleLabel?: string;
};

export async function AppTopBar({ centerContent, notificationsHref, unreadCount, navItems, roleLabel }: AppTopBarProps) {
  const locale = await getLocale();
  const t = await getServerTranslator("common");
  const today = formatDate(new Date(), locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const resolvedNotificationsHref = notificationsHref ?? getPathname({ href: "/notifications", locale });

  const [resolvedUnreadCount, notificationsPreview] = await Promise.all([
    unreadCount !== undefined ? Promise.resolve(unreadCount) : getUnreadCount(),
    getNotifications({ pageSize: 5 }),
  ]);

  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-4 py-4 sm:px-8">
      <div className="flex items-center gap-2">
        {navItems && roleLabel && <AppMobileNav navItems={navItems} roleLabel={roleLabel} />}
        {/* The wordmark returns to the current role's own home (the first nav item's
            destination — /dashboard for a customer, /provider or /admin otherwise), so
            it is never a customer-only "Home" imposed on other roles. */}
        {navItems?.[0]?.href ? (
          <Link href={navItems[0].href} className="rounded focus:outline-none focus:ring-2 focus:ring-primary/20">
            <Logo variant="mark" className="h-8 max-w-[90px]" />
          </Link>
        ) : (
          <Logo variant="mark" className="h-8 max-w-[90px]" />
        )}
      </div>

      {centerContent}

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-foreground/40 lg:inline">{today}</span>

        <button
          type="button"
          disabled
          aria-disabled
          title={t("comingSoonLabel")}
          className="cursor-not-allowed rounded-full p-2 text-foreground/35"
          aria-label={t("languageAriaLabel")}
        >
          <Globe size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled
          aria-disabled
          title={t("comingSoonLabel")}
          className="cursor-not-allowed rounded-full p-2 text-foreground/35"
          aria-label={t("messagesAriaLabel")}
        >
          <MessageCircle size={18} strokeWidth={1.75} />
        </button>
        <NotificationBell
          initialUnreadCount={resolvedUnreadCount}
          initialItems={notificationsPreview.items}
          viewAllHref={resolvedNotificationsHref}
        />
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-secondary" />
        <LogoutButton variant="ghost" />
      </div>
    </div>
  );
}
