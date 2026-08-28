import "server-only";
import { Prisma, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeInternationalPhone } from "@/lib/phone/normalize-international-phone";
import { classifyConvergence, hasRealVerifiedEmail, isSafeToRetire } from "./identity-convergence-policy";
import { findPhoneOwnerUserId, loadIdentitySide } from "./identity-side-loader";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { maskPhoneNumber } from "@/lib/otp/audit";
import { logger } from "@/lib/logger";

// AUTH-PROVIDER-LINK gate 2 — the TRANSACTION ENGINE only.
//
// A DISTINCT operation from customer convergence: a legitimate person who is a Provider
// on an existing phone identity (OWNER A) adopts a newly-verified email from an
// ordinary, zero-history, non-privileged identity (CURRENT B). The Provider A is the
// DETERMINISTIC survivor — it keeps its User, AuthUser, phone P, and Provider row +
// ALL provider/business data untouched; it only ADOPTS B's email E. B is retired
// (DEACTIVATED, retained), its sessions invalidated, its social accounts + notifications
// re-parented to A. NO privilege is ever transferred, and the PHONE is never moved.
//
// This module is server-only and is NOT a "use server" action — nothing (route, client)
// can invoke it. It is exercised only by tests in gate 2; the OTP proof, the public
// action, and the UX are LATER gates. It never sends an OTP.
//
// It re-reads and re-asserts EVERYTHING inside the transaction (never trusting an earlier
// assessment) and fails closed with no partial writes on any violated invariant. The
// email move reuses the SAME proven release-before-claim mechanism as the customer
// convergence transaction (release E from B, then claim it on A) so both engines share
// one email-move semantics.

export type ProviderLinkError =
  | "INVALID_PHONE"
  | "OWNER_NOT_FOUND"
  | "SAME_IDENTITY"
  | "LOAD_FAILED"
  | "OWNER_PHONE_CHANGED" // A no longer owns P (verified)
  | "NOT_PROVIDER_LINK_ELIGIBLE" // classification is not PROVIDER_CREDENTIAL_LINK (staff/admin, B privileged/history, B no email, owner not a provider…)
  | "SURVIVOR_HAS_EMAIL" // A already holds a real verified email — never overwrite it
  | "LOSER_NOT_LINKABLE" // B no longer holds the verified email, or is already retired
  | "UNIQUE_RACE" // P2002 (e.g. Account collision) — fail closed
  | "UNKNOWN_ERROR";

export type ProviderLinkResult = { ok: true; survivorUserId: string } | { ok: false; error: ProviderLinkError };

class ProviderLinkAbort extends Error {
  constructor(public code: ProviderLinkError) {
    super(code);
  }
}

/**
 * Transactionally link CURRENT B's verified email onto the Provider OWNER A that holds
 * phone `phoneRaw`, retiring B. The caller MUST have already proven control of both
 * identities (B via the live session; P/A via a fresh OTP) — proof/OTP is a later gate;
 * this engine performs only the mutation, re-asserting every invariant inside the tx.
 */
export async function linkProviderCredential(currentUserId: string, phoneRaw: string): Promise<ProviderLinkResult> {
  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_PHONE" };
  const phone = normalized.e164;

  try {
    const survivorUserId = await prisma.$transaction(async (tx) => {
      const ownerUserId = await findPhoneOwnerUserId(tx, phone);
      if (!ownerUserId) throw new ProviderLinkAbort("OWNER_NOT_FOUND");
      if (ownerUserId === currentUserId) throw new ProviderLinkAbort("SAME_IDENTITY");

      const [current, owner] = await Promise.all([loadIdentitySide(tx, currentUserId), loadIdentitySide(tx, ownerUserId)]);
      if (!current || !owner) throw new ProviderLinkAbort("LOAD_FAILED");

      // A must still own P (verified) — its phone is never moved, only re-asserted.
      if (owner.authPhone !== phone || !owner.authPhoneVerified) throw new ProviderLinkAbort("OWNER_PHONE_CHANGED");

      // The whole eligibility (Staff/Admin block, provider-only owner, non-privileged B,
      // B has a real verified email, B safe-to-retire) is decided by ONE policy. It MUST
      // classify as a provider credential link with the OWNER as survivor. Anything else
      // → fail closed. This makes it impossible for CURRENT B to become the survivor.
      const decision = classifyConvergence(current, owner);
      if (decision.kind !== "PROVIDER_CREDENTIAL_LINK" || decision.survivor.userId !== owner.userId) {
        throw new ProviderLinkAbort("NOT_PROVIDER_LINK_ELIGIBLE");
      }

      // Defense-in-depth re-assertions (the classifier already implies these):
      if (owner.hasStaffOrAdmin || current.hasStaffOrAdmin) throw new ProviderLinkAbort("NOT_PROVIDER_LINK_ELIGIBLE");
      if (!owner.hasProvider) throw new ProviderLinkAbort("NOT_PROVIDER_LINK_ELIGIBLE");
      if (current.hasPrivilege || !isSafeToRetire(current)) throw new ProviderLinkAbort("NOT_PROVIDER_LINK_ELIGIBLE");
      if (current.status === UserStatus.DEACTIVATED) throw new ProviderLinkAbort("LOSER_NOT_LINKABLE");
      if (!hasRealVerifiedEmail(current)) throw new ProviderLinkAbort("LOSER_NOT_LINKABLE");
      // Never overwrite an email A already holds — A adopts E only if it has none.
      if (hasRealVerifiedEmail(owner)) throw new ProviderLinkAbort("SURVIVOR_HAS_EMAIL");

      const email = current.authEmail as string; // real + verified (asserted above)

      // EMAIL MOVE — release before claim on the AuthUser.email unique index (same
      // mechanism as customer convergence): null it on B, then set it verified on A.
      await tx.authUser.update({ where: { id: current.authUserId }, data: { email: null, emailVerified: false } });
      await tx.authUser.update({ where: { id: owner.authUserId }, data: { email, emailVerified: true } });

      // Re-parent B's social accounts + notifications to A. An Account collision
      // (@@unique(providerId, accountId)) raises P2002 → fail closed (UNIQUE_RACE).
      await tx.account.updateMany({ where: { userId: current.authUserId }, data: { userId: owner.authUserId } });
      await tx.notification.updateMany({ where: { userId: current.userId }, data: { userId: owner.userId } });

      // Retire B: DEACTIVATED (retained, never deleted); its email is already gone, so the
      // moved credential can never resolve back to B. Invalidate every B session.
      await tx.user.update({ where: { id: current.userId }, data: { status: UserStatus.DEACTIVATED } });
      await tx.session.deleteMany({ where: { userId: current.authUserId } });

      // NOTE: no write to A's phone (phone never moves), and no write to ANY
      // Provider/Staff/Admin row — privilege is preserved, never transferred.

      await recordAuditEvent(
        {
          actorType: "SYSTEM",
          actorId: null,
          action: "identity.provider_credential_link_committed",
          entityType: "User",
          entityId: owner.userId,
          newValue: {
            survivorUserId: owner.userId,
            retiredUserId: current.userId,
            movedEmail: true,
            movedPhone: false,
            privilegePreserved: true,
          },
        },
        tx
      );

      return owner.userId;
    });

    logger.info("auth.provider_credential_link_committed", { phoneNumber: maskPhoneNumber(phone) });
    return { ok: true, survivorUserId };
  } catch (error) {
    if (error instanceof ProviderLinkAbort) {
      logger.warn("auth.provider_credential_link_failed", { reason: error.code, phoneNumber: maskPhoneNumber(phone) });
      return { ok: false, error: error.code };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      logger.warn("auth.provider_credential_link_failed", { reason: "UNIQUE_RACE", phoneNumber: maskPhoneNumber(phone) });
      return { ok: false, error: "UNIQUE_RACE" };
    }
    throw error;
  }
}
