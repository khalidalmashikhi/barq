import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { requireInternal, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import type { PermissionKey } from "@/lib/auth";
import { AppShell } from "@/components/app-shell/app-shell";
import { getAdminNavItems } from "@/lib/admin/admin-nav-items";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// STAFF RBAC (Gate Z-3) — the shared internal shell. It now admits any ACTIVE internal
// actor (OWNER/ADMIN or Staff) via requireInternal(), NOT requireAdmin — so a legitimate
// Staff member can enter. Authorization is NOT done here: every page/action/API below
// enforces its own requirePermission(key). This layout only (a) keeps customers/providers
// and deactivated internal accounts out, (b) builds a PERMISSION-DRIVEN nav, and (c) shows
// a safe "no access assigned" state to a Staff member with zero permissions.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  let actor;
  try {
    const internal = await requireInternal();
    actor = internal.actor;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
    }
    if (error instanceof ForbiddenError) {
      // A customer/provider/deactivated account is not an internal actor.
      notFound();
    }
    throw error;
  }

  const t = await getServerTranslator("admin");
  const isAdmin = actor.kind === "ADMIN";
  const isOwner = actor.isOwner;
  // For an ADMIN/OWNER, `permissions` is "ALL" — the nav filter shows them everything via
  // isAdmin/isOwner, so the concrete key set is only meaningful for a STAFF actor.
  const perms = new Set<PermissionKey>(actor.permissions === "ALL" ? [] : actor.permissions);
  const navItems = getAdminNavItems(t, locale, { permissions: perms, isAdmin, isOwner });

  // A Staff member with zero granted permissions has no accessible module — show a safe,
  // localized "no access assigned" state instead of an empty shell or a broken page.
  if (!isAdmin && navItems.length === 0) {
    return (
      <AppShell navItems={[]} roleLabel={t("roleLabel")}>
        <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-8 py-16 text-center">
          <h1 className="text-lg font-semibold text-foreground">{t("staffNoAccessTitle")}</h1>
          <p className="text-sm text-foreground/60">{t("staffNoAccessBody")}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} roleLabel={t("roleLabel")}>
      {children}
    </AppShell>
  );
}
