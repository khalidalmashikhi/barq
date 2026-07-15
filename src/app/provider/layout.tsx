import type { ReactNode } from "react";
import { redirect, notFound } from "next/navigation";
import { LayoutDashboard, Package, CalendarCheck, Clock } from "lucide-react";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { AppShell, type AppNavItem } from "@/components/app-shell/app-shell";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

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

export default async function ProviderLayout({ children }: { children: ReactNode }) {
  try {
    await requireProvider();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }

  const t = await getServerTranslator("provider");

  const providerNavItems: AppNavItem[] = [
    { label: t("navOverview"), href: "/provider", icon: <LayoutDashboard size={18} strokeWidth={1.75} /> },
    { label: t("navServices"), href: "/provider/services", icon: <Package size={18} strokeWidth={1.75} /> },
    { label: t("navBookings"), href: "/provider/bookings", icon: <CalendarCheck size={18} strokeWidth={1.75} /> },
    { label: t("navAvailability"), href: "/provider/availability", icon: <Clock size={18} strokeWidth={1.75} /> },
  ];

  return (
    <AppShell navItems={providerNavItems} roleLabel={t("roleLabel")}>
      {children}
    </AppShell>
  );
}
