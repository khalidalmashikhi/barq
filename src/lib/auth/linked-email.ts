import "server-only";
import { getSession } from "./session";
import { maskEmail } from "@/lib/email-otp/audit";

// AUTH-EMAIL-LINK-1 — read model for the "is a real login email attached to my
// AuthUser?" question the Settings "Sign-in methods" section needs.
//
// Phone-first accounts carry a synthetic, UNVERIFIED `<phone>@phone.barq.internal`
// address (set by the phoneNumber plugin's getTempEmail) — that is NOT a real
// linked email, so "Add email" is offered. A real, verified email means email OTP
// sign-in is available for this account and "Connected" is shown instead.

/** The synthetic auth-email domain the phone plugin assigns (never a real address). */
export const SYNTHETIC_AUTH_EMAIL_DOMAIN = "@phone.barq.internal";

export function isSyntheticAuthEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(SYNTHETIC_AUTH_EMAIL_DOMAIN);
}

export type LinkedEmailState = {
  /** True when a real, verified login email is attached to the current AuthUser. */
  hasRealEmail: boolean;
  /** Masked real email for display (null when none / synthetic / unverified). */
  maskedEmail: string | null;
};

/**
 * The current session's linked-email state, or null when unauthenticated. A real
 * email must be BOTH verified AND non-synthetic to count as linked.
 */
export async function getLinkedEmailState(): Promise<LinkedEmailState | null> {
  const session = await getSession();
  if (!session) return null;

  const email = session.user.email ?? null;
  const verified = session.user.emailVerified === true;
  const real = verified && email !== null && email.trim() !== "" && !isSyntheticAuthEmail(email);

  return { hasRealEmail: real, maskedEmail: real ? maskEmail(email as string) : null };
}
