// Pure tab-resolution logic for the mobile marketplace BottomNav (Marketplace
// Foundation, Phase 1). No React / next-intl imports, so it is unit-testable in
// isolation. PRESENTATION ONLY — the protected destinations still enforce
// requireAuth server-side; for an anonymous visitor they route through /login,
// and Account lands on /dashboard where the existing capability doorways live
// (no capability logic is duplicated here).

export const BOTTOM_NAV_TAB_KEYS = ["home", "explore", "bookings", "notifications", "account"] as const;
export type BottomNavTabKey = (typeof BOTTOM_NAV_TAB_KEYS)[number];
export type BottomNavTab = { key: BottomNavTabKey; href: string; active: boolean };

// Phase 3C — Slice A. EXPLICIT ALLOWLIST of the customer marketplace + account surfaces the shared
// bottom navigation may appear on. Pathname is locale-stripped (from @/i18n/navigation). An
// allowlist (not a denylist) is deliberate: any route NOT named here — provider/admin portals,
// login/OTP, onboarding, provider-application, verification, static legal/marketing pages, and every
// unknown route (including a [locale] not-found or error page for an unmatched path) — shows NO
// bottom nav, so it can never leak onto a surface it was not designed for. The root
// src/app/not-found.tsx renders OUTSIDE [locale], so the nav is not even mounted there.
const CUSTOMER_BOTTOM_NAV_PREFIXES = [
  "/services", // explore + service detail + booking form
  "/providers", // public provider profiles (marketplace)
  "/bookings", // bookings list + details + confirmation
  "/notifications",
  "/dashboard", // customer account + settings
  "/payments",
  "/reviews",
] as const;

/** Whether the shared customer bottom navigation should render for this (locale-stripped) pathname. */
export function isCustomerBottomNavSurface(pathname: string): boolean {
  if (pathname === "/") return true; // home
  return CUSTOMER_BOTTOM_NAV_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function buildBottomNavTabs(isAuthenticated: boolean, pathname: string): BottomNavTab[] {
  return [
    { key: "home", href: "/", active: pathname === "/" },
    { key: "explore", href: "/services", active: pathname.startsWith("/services") },
    { key: "bookings", href: isAuthenticated ? "/bookings" : "/login", active: pathname.startsWith("/bookings") },
    { key: "notifications", href: isAuthenticated ? "/notifications" : "/login", active: pathname.startsWith("/notifications") },
    { key: "account", href: isAuthenticated ? "/dashboard" : "/login", active: pathname.startsWith("/dashboard") },
  ];
}
