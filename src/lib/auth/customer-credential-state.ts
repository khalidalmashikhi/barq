import "server-only";
import { getSession } from "./session";
import { isSyntheticAuthEmail } from "./linked-email";

// AUTH-DUAL-VERIFICATION-1 — the ONE server-side authority for "does this customer
// have both required verified credentials?" A BARQ Customer's onboarding is complete
// only when the SAME AuthUser holds BOTH a verified real email AND a verified phone.
//
// Derived entirely from the authoritative AuthUser verified-credential state
// (emailVerified/email, phoneNumberVerified/phoneNumber) read from the session — NO
// new schema field, and NEVER from UI/localStorage/cookies/client state. A synthetic
// phone placeholder email (<phone>@phone.barq.internal, set by the phoneNumber plugin
// for phone-first accounts) does NOT count as a verified customer email. A Google-first
// user's real, Google-verified email counts (Better Auth sets emailVerified from the
// Google profile), so they are only asked for a phone.
//
// Used by the customer route guard (redirect-if-incomplete-customer.ts) and any
// server action that must block sensitive customer activity until complete.

export type CustomerCredentialState = {
  authenticated: boolean;
  hasVerifiedEmail: boolean;
  hasVerifiedPhone: boolean;
  /** True iff authenticated AND both a verified real email and a verified phone are present. */
  isComplete: boolean;
};

const UNAUTHENTICATED: CustomerCredentialState = {
  authenticated: false,
  hasVerifiedEmail: false,
  hasVerifiedPhone: false,
  isComplete: false,
};

export async function getCustomerCredentialState(): Promise<CustomerCredentialState> {
  const session = await getSession();
  if (!session) return UNAUTHENTICATED;

  const user = session.user as {
    email?: string | null;
    emailVerified?: boolean;
    phoneNumber?: string | null;
    phoneNumberVerified?: boolean;
  };

  const email = user.email ?? null;
  const hasVerifiedEmail =
    user.emailVerified === true && email !== null && email.trim() !== "" && !isSyntheticAuthEmail(email);

  const phone = user.phoneNumber ?? null;
  const hasVerifiedPhone = user.phoneNumberVerified === true && phone !== null && phone.trim() !== "";

  return {
    authenticated: true,
    hasVerifiedEmail,
    hasVerifiedPhone,
    isComplete: hasVerifiedEmail && hasVerifiedPhone,
  };
}
