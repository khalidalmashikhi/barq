import "server-only";
import { getSession } from "./session";
import { maskPhoneNumber } from "@/lib/otp/audit";

// AUTH-DUAL-IDENTITY-1 — read model for the "is a verified phone attached to my
// account?" question the Settings "Sign-in methods" section needs (the mirror of
// linked-email.ts). Unlike email, phone has no synthetic form: AuthUser.phoneNumber
// is either a real +968 number (when phone-first, or after Add phone) or null
// (email-first / Google-first). A phone counts as linked only when verified.

export type LinkedPhoneState = {
  /** True when a verified phone is attached to the current AuthUser. */
  hasPhone: boolean;
  /** Masked phone for display (null when none / unverified). */
  maskedPhone: string | null;
};

export async function getLinkedPhoneState(): Promise<LinkedPhoneState | null> {
  const session = await getSession();
  if (!session) return null;

  const user = session.user as { phoneNumber?: string | null; phoneNumberVerified?: boolean };
  const phone = user.phoneNumber ?? null;
  const verified = user.phoneNumberVerified === true;
  const has = verified && phone !== null && phone.trim() !== "";

  return { hasPhone: has, maskedPhone: has ? maskPhoneNumber(phone as string) : null };
}
