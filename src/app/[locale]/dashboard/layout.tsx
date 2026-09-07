import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { resolveEffectiveAccountTypeForSession } from "@/lib/auth";
import { requireCompleteCustomer } from "@/lib/auth/require-complete-customer";

// AUTH-DUAL-VERIFICATION-1 + EXCLUSIVE ACCOUNT TYPES (Gate Z-2) — the central customer-
// surface guard. Two layers, in order:
//
//   1. An UNCLASSIFIED identity (authenticated, but no finalized profile yet — the bridge
//      no longer auto-creates a Customer) is sent to /onboarding, the registration
//      continuation that drives choose-usage → details → verify-email → finalize. This
//      keeps a mid-registration identity out of the customer dashboard entirely (its
//      customer loaders would have no Customer row). ADMIN/STAFF/PROVIDER are NOT
//      UNCLASSIFIED, so they are never diverted here (the /dashboard index page diverts
//      ADMIN→/admin and PROVIDER→/provider; a PROVIDER keeps read access to sub-pages).
//   2. A classified CUSTOMER who has not yet verified BOTH a phone AND a real email is
//      redirected to /onboarding (the existing dual-verification completion gate).
//
// Neither layer enforces authentication (the pages' own requireAuth() owns that); an
// unresolved session falls through untouched. /onboarding lives OUTSIDE /dashboard, so
// completing there is never caught here (no redirect loop).
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if ((await resolveEffectiveAccountTypeForSession()) === "UNCLASSIFIED") {
    const locale = await getLocale();
    redirect({ href: "/onboarding", locale });
  }
  await requireCompleteCustomer();
  return <>{children}</>;
}
