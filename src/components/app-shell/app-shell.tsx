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

export type { AppNavItem };

type AppShellProps = {
  navItems: AppNavItem[];
  roleLabel: string;
  topBarCenterContent?: ReactNode;
  children: ReactNode;
};

export function AppShell({ navItems, roleLabel, topBarCenterContent, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <AppTopBar centerContent={topBarCenterContent} />

      <div className="flex">
        <AppSidebar navItems={navItems} roleLabel={roleLabel} />

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
