import type { ReactNode } from "react";
import { AppSidebar, type AppNavItem } from "./app-sidebar";
import { AppTopBar } from "./app-top-bar";

// AppShell — AppShell Migration (Stabilization).
//
// The one reusable application shell for every authenticated,
// role-scoped area of BARQ (Customer today; Provider/Admin/Staff
// later, per the approved architecture review) — composes AppTopBar +
// AppSidebar + a main content area, replacing the inline
// TopBar/Sidebar/main markup the Customer dashboard page used to
// assemble by hand. A role's own page supplies its nav items, role
// label, and optional top-bar center content; this component owns none
// of that role-specific data itself.
//
// Route structure is explicitly NOT nested under this component —
// each role keeps its own flat top-level route (/dashboard, /provider,
// future /admin, /staff), per the approved architecture decision. This
// component is shared code, not a shared URL namespace.
//
// Phase D.1 — notificationsHref: optional pass-through to AppTopBar's
// real NotificationBell "View All" link. Left optional/undefined for
// every existing Customer call site (AppTopBar defaults it to the
// Customer route itself); only Provider's layout.tsx supplies its own
// "/provider/notifications" override, exactly as it already does for
// its own nav item hrefs.
//
// Phase D.1 — unreadNotificationsCount: every caller that builds its
// own nav items now independently fetches getUnreadCount() to badge
// its own "Notifications" nav item (a real, per-user number, replacing
// the hardcoded fake badge removed in Phase C.3 Group 5) — passing
// that same number through here lets AppTopBar's bell reuse it instead
// of running its own second, identical COUNT query on every single
// page render. AppTopBar still runs its own fetch as a fallback if a
// caller omits this, so no existing behavior breaks if a future
// AppShell call site forgets to pass it.

export type { AppNavItem };

type AppShellProps = {
  navItems: AppNavItem[];
  roleLabel: string;
  topBarCenterContent?: ReactNode;
  notificationsHref?: string;
  unreadNotificationsCount?: number;
  children: ReactNode;
};

export function AppShell({
  navItems,
  roleLabel,
  topBarCenterContent,
  notificationsHref,
  unreadNotificationsCount,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <AppTopBar
        centerContent={topBarCenterContent}
        notificationsHref={notificationsHref}
        unreadCount={unreadNotificationsCount}
        navItems={navItems}
        roleLabel={roleLabel}
      />

      <div className="flex">
        <AppSidebar navItems={navItems} roleLabel={roleLabel} />

        <main id="main-content" className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
