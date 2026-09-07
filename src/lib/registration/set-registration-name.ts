"use server";

import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError, resolveEffectiveAccountType } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { RegistrationResult } from "./registration-errors";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Persists the registrant's display name
// onto the CANONICAL User.name field (the same self-editable identity name every role
// reuses — no new "pending registration" storage). Because it lives on the durable User
// row, the name survives refresh, browser close/reopen, email-OTP interruption, and
// multi-device continuation. Only writable while UNCLASSIFIED (during registration); a
// classified user edits their name through the normal profile surface.

const NAME_MIN = 2;
const NAME_MAX = 80;

export async function setRegistrationName(rawName: string): Promise<RegistrationResult> {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, error: "INVALID_NAME" };
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
    const effectiveType = await resolveEffectiveAccountType(barqUserId);
    if (effectiveType !== "UNCLASSIFIED") {
      return { ok: false, error: "ALREADY_CLASSIFIED" };
    }
    await prisma.user.update({ where: { id: barqUserId }, data: { name } });
    return { ok: true };
  } catch (error) {
    logger.error("setRegistrationName.unexpected_error", {
      userId: barqUserId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
