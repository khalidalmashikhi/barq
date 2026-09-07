import "server-only";
import type { AccountType, User } from "@prisma/client";
import { getCustomerCredentialState } from "@/lib/auth/customer-credential-state";
import { resolveEffectiveAccountType, type EffectiveAccountType } from "@/lib/auth/effective-account-type";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. The ONE server-side authority for
// "what is the next registration step for this identity?", derived entirely from
// durable, server-authoritative state (never the browser):
//   • the Z-1 effective account type (any finalized/legacy/admin/staff identity is DONE),
//   • the declared self-service intent (User.accountType),
//   • the canonical display name (User.name), persisted across steps/devices,
//   • the verified phone + real (non-synthetic) verified email (AuthUser, via session).
//
// Because every input is durable server state, refresh / browser-reopen / OTP
// interruption / multi-device continuation all resume at the same step with no lost
// intent and no duplicate profiles.

export type RegistrationStep = "CHOOSE_USAGE" | "COMPLETE_DETAILS" | "VERIFY_EMAIL" | "FINALIZE" | "DONE";

export type RegistrationSnapshot = {
  /** Z-1 authoritative classification. Anything other than UNCLASSIFIED is already DONE. */
  effectiveType: EffectiveAccountType;
  /** Declared self-service intent; null until the chooser is submitted. */
  declaredType: AccountType | null;
  hasName: boolean;
  hasVerifiedPhone: boolean;
  /** Real, verified, non-synthetic email (synthetic <phone>@phone.barq.internal does NOT count). */
  hasVerifiedEmail: boolean;
};

/**
 * Pure step resolution. Order mirrors the approved journey:
 *   phone verified (entry) → CHOOSE_USAGE → COMPLETE_DETAILS (name; also phone for a
 *   social-first identity that lacks one) → VERIFY_EMAIL → FINALIZE → DONE.
 *
 * A classified/legacy/admin/staff identity (effectiveType !== UNCLASSIFIED) is DONE and
 * NEVER walked through registration — this is what keeps returning users and legacy
 * accounts out of the chooser.
 */
export function resolveRegistrationStep(s: RegistrationSnapshot): RegistrationStep {
  if (s.effectiveType !== "UNCLASSIFIED") return "DONE";
  if (s.declaredType === null) return "CHOOSE_USAGE";
  if (!s.hasName || !s.hasVerifiedPhone) return "COMPLETE_DETAILS";
  if (!s.hasVerifiedEmail) return "VERIFY_EMAIL";
  return "FINALIZE";
}

/** True once the identity is a real display name (non-empty after trimming). */
export function hasRegistrationName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim() !== "";
}

/**
 * Server resolver for the current authenticated identity. Reads the Z-1 effective type
 * and the credential state; the declared type + name come from the already-loaded User
 * (requireAuth's barqUser), so no extra User read is needed.
 */
export async function getRegistrationStepForUser(
  barqUser: Pick<User, "id" | "name" | "accountType">
): Promise<RegistrationStep> {
  const [effectiveType, cred] = await Promise.all([
    resolveEffectiveAccountType(barqUser.id),
    getCustomerCredentialState(),
  ]);
  return resolveRegistrationStep({
    effectiveType,
    declaredType: barqUser.accountType ?? null,
    hasName: hasRegistrationName(barqUser.name),
    hasVerifiedPhone: cred.hasVerifiedPhone,
    hasVerifiedEmail: cred.hasVerifiedEmail,
  });
}
