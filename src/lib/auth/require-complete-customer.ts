import "server-only";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isActiveAdminSession } from "./index";
import { getCustomerCredentialState } from "./customer-credential-state";

// AUTH-DUAL-VERIFICATION-1 — the central Customer-completion guard. Call it at the
// narrow set of authenticated CUSTOMER surfaces (the customer dashboard layout, the
// booking page) so an incomplete customer is funnelled to /onboarding before any
// sensitive customer activity. ONE authority (getCustomerCredentialState); no
// scattered ad-hoc checks.
//
// Deliberately does NOT enforce authentication itself — the caller's own
// requireAuth()/requireCustomer() owns that; an unauthenticated visitor is left for
// the caller to redirect to /login (never to /onboarding). ACTIVE admins operate in
// the backoffice and are never funnelled through customer onboarding (Gate A). The
// /onboarding page must NOT call this (it would loop) — it checks completion itself
// and redirects a COMPLETE user onward instead.

export async function requireCompleteCustomer(): Promise<void> {
  const state = await getCustomerCredentialState();
  if (!state.authenticated || state.isComplete) return;
  if (await isActiveAdminSession()) return;

  const locale = await getLocale();
  redirect({ href: "/onboarding", locale });
}
