"use server";

import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError, resolveEffectiveAccountType } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { RegistrationResult } from "./registration-errors";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Choose-usage is SERVER-AUTHORITATIVE:
// the declared intent is validated and written here, never trusted from client state.
//
// LOCKING: the choice may be changed freely (CUSTOMER <-> PROVIDER) ONLY while the
// identity is still UNCLASSIFIED (no profile finalized). The moment a profile exists
// the effective type is CUSTOMER/PROVIDER/ADMIN/STAFF and this refuses with
// ALREADY_CLASSIFIED — so there is no self-service type switch after finalization.
// It NEVER creates a profile; it only records the declared intent on User.accountType.

export async function setAccountType(type: "CUSTOMER" | "PROVIDER"): Promise<RegistrationResult> {
  // Validate the input server-side BEFORE any auth work; never trust the caller's string.
  if (type !== "CUSTOMER" && type !== "PROVIDER") {
    return { ok: false, error: "INVALID_TYPE" };
  }

  let barqUserId: string;
  try {
    const auth = await requireAuth();
    barqUserId = auth.barqUser.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: "UNKNOWN_ERROR" };
    }
    throw error;
  }

  try {
    // Server-authoritative locking: only an UNCLASSIFIED identity may (re)declare intent.
    // A finalized/legacy/admin/staff identity is never re-typed through self-service.
    const effectiveType = await resolveEffectiveAccountType(barqUserId);
    if (effectiveType !== "UNCLASSIFIED") {
      return { ok: false, error: "ALREADY_CLASSIFIED" };
    }

    await prisma.user.update({ where: { id: barqUserId }, data: { accountType: type } });
    return { ok: true };
  } catch (error) {
    logger.error("setAccountType.unexpected_error", {
      userId: barqUserId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
