"use server";

import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { auth } from "./server";
import { requireAuth, UnauthenticatedError, ForbiddenError } from "./index";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/email-otp/normalize-email";
import { isSyntheticAuthEmail } from "./linked-email";
import { resolveClientIp, hmacRateLimitKey } from "@/lib/rate-limit/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit/durable-rate-limiter";
import { getEmailOtpConfig } from "@/lib/email-otp/email-otp-config";
import {
  getEmailOtpSendIpRateLimit,
  getEmailOtpSendEmailRateLimit,
  getEmailOtpVerifyIpRateLimit,
  emailOtpSendIpKey,
  emailOtpSendEmailKey,
  emailOtpSendCooldownKey,
  emailOtpVerifyIpKey,
} from "@/lib/email-otp/email-otp-rate-limit-config";
import { maskEmail } from "@/lib/email-otp/audit";
import { logger } from "@/lib/logger";

// AUTH-EMAIL-LINK-1 — the BARQ-owned, server-authoritative orchestration for the
// authenticated "Add email" flow. It NEVER creates a second identity and NEVER
// merges: it delegates the actual credential mutation to Better Auth's OTP-based
// change-email (auth.api.requestEmailChangeEmailOTP / auth.api.changeEmailEmailOTP),
// which does updateUser(currentAuthUser.id, {email, emailVerified:true}) on the SAME
// AuthUser (verified against better-auth@1.6.23). This module adds the BARQ policy
// around that primitive: authentication, canonical email normalization, synthetic-
// domain rejection, the "already has a real email" guard (§8 — never silently
// overwrite), the generic ACCOUNT_LINK_CONFLICT pre-check (§5/§8/§9 — never merge,
// never leak the other account), durable rate limiting, and masked audit logging.
//
// The client calls these server actions; it never touches AuthUser.email directly.

export type EmailLinkErrorCode =
  | "NOT_AUTHENTICATED"
  | "INVALID_EMAIL"
  | "ALREADY_HAS_EMAIL"
  | "ACCOUNT_LINK_CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_OTP"
  | "EMAIL_DELIVERY_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export type EmailLinkResult = { ok: true } | { ok: false; error: EmailLinkErrorCode };

function maskLog(email: string): string {
  return maskEmail(email);
}

/** Resolve the authenticated AuthUser id, or a typed NOT_AUTHENTICATED failure. */
async function requireAuthUserId(): Promise<{ authUserId: string } | { error: EmailLinkErrorCode }> {
  try {
    const { authUserId } = await requireAuth();
    return { authUserId };
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      return { error: "NOT_AUTHENTICATED" };
    }
    throw error;
  }
}

async function rateLimitKeys(email: string) {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const ipKey = hmacRateLimitKey(resolveClientIp(await headers()), secret);
  const emailKey = hmacRateLimitKey(email, secret);
  return { ipKey, emailKey };
}

/**
 * Step 1 — send an ownership-proof OTP to `newEmailRaw` for the CURRENT authenticated
 * AuthUser. Rejects: unauthenticated, malformed/synthetic email, an account that
 * already has a real linked email, an email owned by another AuthUser
 * (ACCOUNT_LINK_CONFLICT), and rate-limited callers. On success an OTP is sent (or
 * fails closed if no email vendor is configured).
 */
export async function requestEmailLink(newEmailRaw: string): Promise<EmailLinkResult> {
  const authResult = await requireAuthUserId();
  if ("error" in authResult) return { ok: false, error: authResult.error };
  const { authUserId } = authResult;

  const normalized = normalizeEmail(newEmailRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_EMAIL" };
  const newEmail = normalized.email;

  // A synthetic phone address is never a linkable login email.
  if (isSyntheticAuthEmail(newEmail)) return { ok: false, error: "INVALID_EMAIL" };

  const me = await prisma.authUser.findUnique({
    where: { id: authUserId },
    select: { email: true, emailVerified: true },
  });
  if (!me) return { ok: false, error: "UNKNOWN_ERROR" };

  // §8 — never silently overwrite a real, verified email via "Add email".
  const alreadyReal =
    me.emailVerified === true && me.email !== null && !isSyntheticAuthEmail(me.email);
  if (alreadyReal) return { ok: false, error: "ALREADY_HAS_EMAIL" };

  const { ipKey, emailKey } = await rateLimitKeys(newEmail);

  const { resendCooldownSeconds } = getEmailOtpConfig();
  const cooldown = await consumeRateLimit(emailOtpSendCooldownKey(emailKey), 1, resendCooldownSeconds);
  if (!cooldown.allowed) return { ok: false, error: "RATE_LIMITED" };
  const sendIp = getEmailOtpSendIpRateLimit();
  if (!(await consumeRateLimit(emailOtpSendIpKey(ipKey), sendIp.limit, sendIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  const sendEmail = getEmailOtpSendEmailRateLimit();
  if (!(await consumeRateLimit(emailOtpSendEmailKey(emailKey), sendEmail.limit, sendEmail.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Generic conflict pre-check: the email already belongs to a DIFFERENT AuthUser.
  // Never merges, never reveals anything about the other account (§5/§8/§9).
  const owner = await prisma.authUser.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (owner && owner.id !== authUserId) {
    logger.warn("auth.email_link_conflict", { authUserId, email: maskLog(newEmail) });
    return { ok: false, error: "ACCOUNT_LINK_CONFLICT" };
  }

  logger.info("auth.email_link_requested", { authUserId, email: maskLog(newEmail) });

  try {
    await auth.api.requestEmailChangeEmailOTP({ body: { newEmail }, headers: await headers() });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthApiError(error) };
  }
}

/**
 * Step 2 — verify the OTP and attach `newEmailRaw` to the CURRENT AuthUser. On
 * success the same AuthUser now holds the verified real email (updateUser); no new
 * identity, no re-parent. Wrong/expired OTP → INVALID_OTP, no mutation. A late
 * conflict (email taken between request and verify) → ACCOUNT_LINK_CONFLICT.
 */
export async function verifyEmailLink(newEmailRaw: string, otp: string): Promise<EmailLinkResult> {
  const authResult = await requireAuthUserId();
  if ("error" in authResult) return { ok: false, error: authResult.error };
  const { authUserId } = authResult;

  const normalized = normalizeEmail(newEmailRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_EMAIL" };
  const newEmail = normalized.email;
  if (typeof otp !== "string" || otp.trim() === "") return { ok: false, error: "INVALID_OTP" };

  const { ipKey } = await rateLimitKeys(newEmail);
  const verifyIp = getEmailOtpVerifyIpRateLimit();
  if (!(await consumeRateLimit(emailOtpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  try {
    await auth.api.changeEmailEmailOTP({ body: { newEmail, otp }, headers: await headers() });
    logger.info("auth.email_linked", { authUserId, email: maskLog(newEmail) });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthApiError(error) };
  }
}

/** Map a Better Auth change-email failure to a stable, non-leaking BARQ code. */
function mapAuthApiError(error: unknown): EmailLinkErrorCode {
  if (isAPIError(error)) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_OTP" || code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") return "INVALID_OTP";
    if (code === "INVALID_EMAIL") return "INVALID_EMAIL";
    if (code === "EMAIL_DELIVERY_UNAVAILABLE") return "EMAIL_DELIVERY_UNAVAILABLE";
    const message = (error.body as { message?: string } | undefined)?.message ?? error.message ?? "";
    // Better Auth signals a taken email at change-time with this message (no code).
    if (/already in use/i.test(message)) return "ACCOUNT_LINK_CONFLICT";
  }
  return "UNKNOWN_ERROR";
}
