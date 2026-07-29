import "server-only";
import { prisma } from "@/lib/db";

// Resend-cooldown enforcement — Phase D.4.
//
// Better Auth's own phoneNumber plugin implements OTP expiration and
// failed-attempt limiting internally (confirmed by reading
// node_modules/better-auth/dist/plugins/phone-number/routes.mjs in
// full) but has NO resend-cooldown check at all: calling
// /phone-number/send-otp repeatedly just keeps overwriting the stored
// code with a fresh expiry. This is the one genuinely missing piece,
// built here by querying the plugin's own `Verification` table
// directly (identifier = phone number) rather than adding any new
// Prisma model — the existing columns (identifier, createdAt) are
// exactly what a cooldown check needs.

export interface ResendCooldownResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkResendCooldown(
  phoneNumber: string,
  cooldownSeconds: number
): Promise<ResendCooldownResult> {
  const mostRecent = await prisma.verification.findFirst({
    where: { identifier: phoneNumber },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!mostRecent) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const elapsedSeconds = (Date.now() - mostRecent.createdAt.getTime()) / 1000;
  if (elapsedSeconds >= cooldownSeconds) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { allowed: false, retryAfterSeconds: Math.ceil(cooldownSeconds - elapsedSeconds) };
}
