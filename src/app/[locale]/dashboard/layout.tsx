import type { ReactNode } from "react";
import { requireCompleteCustomer } from "@/lib/auth/require-complete-customer";

// AUTH-DUAL-VERIFICATION-1 — the central Customer-completion enforcement for the
// customer dashboard. An authenticated customer who has not yet verified BOTH a
// phone AND a real email is redirected to /onboarding before reaching any customer
// dashboard surface (overview, bookings, settings, …). One guard, one authority.
//
// It does NOT enforce authentication (the pages' own requireAuth() owns that, and an
// unauthenticated visitor is left for them to send to /login), and it never touches
// active-admin sessions (backoffice, Gate A). /onboarding lives OUTSIDE /dashboard,
// so completing there is never caught by this guard (no redirect loop).
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireCompleteCustomer();
  return <>{children}</>;
}
