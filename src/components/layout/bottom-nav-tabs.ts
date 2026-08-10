// Pure tab-resolution logic for the mobile marketplace BottomNav (Marketplace
// Foundation, Phase 1). No React / next-intl imports, so it is unit-testable in
// isolation. PRESENTATION ONLY — the protected destinations still enforce
// requireAuth server-side; for an anonymous visitor they route through /login,
// and Account lands on /dashboard where the existing capability doorways live
// (no capability logic is duplicated here).

export const BOTTOM_NAV_TAB_KEYS = ["home", "explore", "bookings", "notifications", "account"] as const;
export type BottomNavTabKey = (typeof BOTTOM_NAV_TAB_KEYS)[number];
export type BottomNavTab = { key: BottomNavTabKey; href: string; active: boolean };

export function buildBottomNavTabs(isAuthenticated: boolean, pathname: string): BottomNavTab[] {
  return [
    { key: "home", href: "/", active: pathname === "/" },
    { key: "explore", href: "/services", active: pathname.startsWith("/services") },
    { key: "bookings", href: isAuthenticated ? "/bookings" : "/login", active: pathname.startsWith("/bookings") },
    { key: "notifications", href: isAuthenticated ? "/notifications" : "/login", active: pathname.startsWith("/notifications") },
    { key: "account", href: isAuthenticated ? "/dashboard" : "/login", active: pathname.startsWith("/dashboard") },
  ];
}
