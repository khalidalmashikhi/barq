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

// PLATFORM-CUSTOMER-CREDENTIALS-API-1 — the SAME rule, without the navigation.
//
// `requireCompleteCustomer()` above answers a browser: it redirects. That is right for
// a page and wrong for an API, where a redirect is not an answer a native client can
// read, explain, or act on — it arrives as an HTML navigation instruction or an
// unhandled throw.
//
// So the RULE is factored out and the PRESENTATION is left to the caller. Both
// functions consult exactly one authority, `getCustomerCredentialState()`, and apply
// exactly one ACTIVE-admin exemption. There is no second definition of "complete"
// anywhere, and this function relaxes nothing: it returns the same verdict the
// redirecting guard acts on.
//
// Returns TRUE when the caller may proceed. An UNAUTHENTICATED caller is `true` here
// for the same reason it is a no-op above: authentication is the caller's own gate
// (requireAuth/requireCustomer), and this must never turn a missing session into a
// completeness problem.
export async function isCustomerCompleteForAction(): Promise<boolean> {
  const state = await getCustomerCredentialState();
  if (!state.authenticated || state.isComplete) return true;
  return await isActiveAdminSession();
}
