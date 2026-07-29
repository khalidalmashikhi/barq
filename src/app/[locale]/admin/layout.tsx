import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { AppShell } from "@/components/app-shell/app-shell";
import { getAdminNavItems } from "@/lib/admin/admin-nav-items";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Admin layout — Phase 4.1 ("Complete the Booking Lifecycle"),
// requirement #6: "Build the minimum admin workflow required to make
// the Verified badge meaningful. Reuse existing RBAC. Do not redesign
// Admin." This is the first admin UI surface in the codebase (only a
// disabled test API route existed before) — mirrors
// src/app/[locale]/provider/layout.tsx exactly: same
// UnauthenticatedError/ForbiddenError -> redirect/notFound() handling,
// same noindex/nofollow, same AppShell composition.
//
// Admin Operations Platform: the nav array now comes from the shared,
// testable getAdminNavItems() helper (mirrors
// src/lib/dashboard/customer-nav-items.tsx's own extraction) instead
// of being defined inline — "Overview" is now the first item, and
// Customers/Reviews are real, navigable routes this phase adds. Every
// pre-existing route/capability is unchanged.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
    }
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }

  const t = await getServerTranslator("admin");
  const adminNavItems = getAdminNavItems(t, locale);

  return (
    <AppShell navItems={adminNavItems} roleLabel={t("roleLabel")}>
      {children}
    </AppShell>
  );
}
