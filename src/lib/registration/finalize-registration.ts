"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { getCustomerCredentialState } from "@/lib/auth/customer-credential-state";
import { logger } from "@/lib/logger";
import type { RegistrationResult } from "./registration-errors";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. The single, atomic, idempotent,
// race-safe finalization: it creates EXACTLY the one profile the identity declared, and
// can NEVER produce a Customer+Provider dual for a new-era account.
//
// CRITICAL INVARIANT (server-enforced, never UI):
//   accountType CUSTOMER → exactly one Customer, zero Provider.
//   accountType PROVIDER → exactly one Provider(DRAFT), zero Customer.
//
// Preconditions (all server-authoritative): authenticated; declared accountType present;
// a display name; a verified phone; and a REAL, verified, non-synthetic email. A
// synthetic <phone>@phone.barq.internal never counts (getCustomerCredentialState).
//
// FAIL CLOSED: if a conflicting/opposite profile unexpectedly already exists, it refuses
// (PROFILE_CONFLICT) — it never creates the second profile and never deletes the existing
// one. Idempotent: re-running once already-finalized returns ok. Concurrency: the
// per-profile @@unique(userId) is the arbiter — a lost race (P2002) re-reads the winner.

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function finalizeRegistration(): Promise<RegistrationResult> {
  let barqUser;
  try {
    const auth = await requireAuth();
    barqUser = auth.barqUser;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: "UNKNOWN_ERROR" };
    }
    throw error;
  }

  const declared = barqUser.accountType;
  if (declared !== "CUSTOMER" && declared !== "PROVIDER") {
    return { ok: false, error: "NO_DECLARED_TYPE" };
  }
  const hasName = typeof barqUser.name === "string" && barqUser.name.trim() !== "";
  if (!hasName) {
    return { ok: false, error: "NAME_REQUIRED" };
  }

  // Real, verified credentials — a synthetic phone-placeholder email never qualifies.
  const cred = await getCustomerCredentialState();
  if (!cred.hasVerifiedPhone) return { ok: false, error: "PHONE_NOT_VERIFIED" };
  if (!cred.hasVerifiedEmail) return { ok: false, error: "EMAIL_NOT_VERIFIED" };

  const userId = barqUser.id;
  const displayName = barqUser.name!.trim();

  try {
    return await prisma.$transaction(async (tx) => {
      // Re-read authoritative profile state INSIDE the transaction.
      const [customer, provider] = await Promise.all([
        tx.customer.findUnique({ where: { userId }, select: { id: true } }),
        tx.provider.findUnique({ where: { userId }, select: { id: true } }),
      ]);

      // A dual should be impossible for a new-era account; if seen, fail closed (never
      // "fix" it by deleting a side here — that is a separate audited concern).
      if (customer && provider) {
        logger.error("finalizeRegistration.dual_profile_conflict", { userId });
        return { ok: false, error: "PROFILE_CONFLICT" } as RegistrationResult;
      }

      if (declared === "CUSTOMER") {
        if (provider) {
          logger.error("finalizeRegistration.opposite_profile_conflict", { userId, declared });
          return { ok: false, error: "PROFILE_CONFLICT" } as RegistrationResult;
        }
        if (customer) return { ok: true } as RegistrationResult; // idempotent
        await tx.customer.create({ data: { userId } });
        return { ok: true } as RegistrationResult;
      }

      // declared === "PROVIDER"
      if (customer) {
        logger.error("finalizeRegistration.opposite_profile_conflict", { userId, declared });
        return { ok: false, error: "PROFILE_CONFLICT" } as RegistrationResult;
      }
      if (provider) return { ok: true } as RegistrationResult; // idempotent
      // A minimal DRAFT provider seeded from the display name; the provider completes
      // real business details + category + documents in the existing onboarding before
      // submitting for review. businessName is the only field required beyond userId.
      await tx.provider.create({
        data: {
          userId,
          businessName: { ar: displayName, en: displayName },
          status: "DRAFT",
        },
      });
      return { ok: true } as RegistrationResult;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent finalize won the @@unique(userId) race. Re-read the winner: if it
      // produced the correct single profile, this is an idempotent success; otherwise
      // report the conflict without ever creating a dual.
      const [customer, provider] = await Promise.all([
        prisma.customer.findUnique({ where: { userId }, select: { id: true } }),
        prisma.provider.findUnique({ where: { userId }, select: { id: true } }),
      ]);
      if (declared === "CUSTOMER" && customer && !provider) return { ok: true };
      if (declared === "PROVIDER" && provider && !customer) return { ok: true };
      return { ok: false, error: "PROFILE_CONFLICT" };
    }
    logger.error("finalizeRegistration.unexpected_error", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
