"use server";

import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { Prisma } from "@prisma/client";
import { auth } from "./server";
import { requireAuth, UnauthenticatedError, ForbiddenError } from "./index";
import { prisma } from "@/lib/db";
import { normalizeInternationalPhone } from "@/lib/phone/normalize-international-phone";
import { resolveClientIp, hmacRateLimitKey } from "@/lib/rate-limit/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit/durable-rate-limiter";
import {
  getOtpSendIpRateLimit,
  getOtpSendPhoneRateLimit,
  getOtpVerifyIpRateLimit,
  otpSendIpKey,
  otpSendPhoneKey,
  otpVerifyIpKey,
} from "@/lib/otp/otp-rate-limit-config";
import { maskPhoneNumber } from "@/lib/otp/audit";
import { logger } from "@/lib/logger";

// AUTH-DUAL-IDENTITY-1 — the BARQ-owned "Add phone" flow: the mirror of
// src/lib/auth/link-email.ts, for an email-first / Google-first (phone-less) user
// to attach a verified phone to their EXISTING account. It NEVER creates a second
// identity and NEVER merges: it delegates the credential mutation to Better Auth's
// /phone-number/verify with `updatePhoneNumber: true`, which (verified against
// better-auth@1.6.23) requires a session, rejects a phone already on another user
// (PHONE_NUMBER_EXIST), and does updateUser(currentAuthUser.id, {phoneNumber,
// phoneNumberVerified:true}) on the SAME AuthUser. BARQ adds the policy around it:
// authentication, international E.164 canonicalization (normalizeInternationalPhone,
// the same authority used at login), ACCOUNT_LINK_CONFLICT pre-check (AuthUser AND
// domain User), the "already has a phone" guard, rate limiting, masked audit, and a
// domain User.phoneNumber sync so the canonical User row reflects the phone.
//
// The client calls these server actions; it never mutates AuthUser/User directly.

export type PhoneLinkErrorCode =
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "ALREADY_HAS_PHONE"
  | "ACCOUNT_LINK_CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_OTP"
  | "OTP_DELIVERY_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export type PhoneLinkResult = { ok: true } | { ok: false; error: PhoneLinkErrorCode };

async function requireAuthCtx(): Promise<
  { authUserId: string; barqUserId: string; hasPhone: boolean } | { error: PhoneLinkErrorCode }
> {
  try {
    const { authUserId, barqUser } = await requireAuth();
    return { authUserId, barqUserId: barqUser.id, hasPhone: barqUser.phoneNumber !== null };
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      return { error: "NOT_AUTHENTICATED" };
    }
    throw error;
  }
}

async function rateLimitKeys(phone: string) {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const ipKey = hmacRateLimitKey(resolveClientIp(await headers()), secret);
  const phoneKey = hmacRateLimitKey(phone, secret);
  return { ipKey, phoneKey };
}

/** True iff `phone` already belongs to a DIFFERENT AuthUser or a DIFFERENT domain User. */
async function phoneOwnedByAnother(phone: string, authUserId: string, barqUserId: string): Promise<boolean> {
  const authOwner = await prisma.authUser.findUnique({ where: { phoneNumber: phone }, select: { id: true } });
  if (authOwner && authOwner.id !== authUserId) return true;
  const userOwner = await prisma.user.findUnique({ where: { phoneNumber: phone }, select: { id: true } });
  if (userOwner && userOwner.id !== barqUserId) return true;
  return false;
}

/**
 * Step 1 — send an ownership-proof OTP to `phoneRaw` for the CURRENT authenticated
 * account. Rejects: unauthenticated, malformed/non-Oman phone, an account that
 * already has a phone, a phone owned by another account (ACCOUNT_LINK_CONFLICT),
 * and rate-limited callers.
 */
export async function requestPhoneLink(phoneRaw: string): Promise<PhoneLinkResult> {
  const ctx = await requireAuthCtx();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_PHONE" };
  const phone = normalized.e164;

  if (ctx.hasPhone) return { ok: false, error: "ALREADY_HAS_PHONE" };

  const { ipKey, phoneKey } = await rateLimitKeys(phone);
  const sendIp = getOtpSendIpRateLimit();
  if (!(await consumeRateLimit(otpSendIpKey(ipKey), sendIp.limit, sendIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  const sendPhone = getOtpSendPhoneRateLimit();
  if (!(await consumeRateLimit(otpSendPhoneKey(phoneKey), sendPhone.limit, sendPhone.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  if (await phoneOwnedByAnother(phone, ctx.authUserId, ctx.barqUserId)) {
    logger.warn("auth.phone_link_conflict", { authUserId: ctx.authUserId, phoneNumber: maskPhoneNumber(phone) });
    return { ok: false, error: "ACCOUNT_LINK_CONFLICT" };
  }

  logger.info("auth.phone_link_requested", { authUserId: ctx.authUserId, phoneNumber: maskPhoneNumber(phone) });

  try {
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone }, headers: await headers() });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapPhoneApiError(error) };
  }
}

/**
 * Step 2 — verify the OTP and attach `phoneRaw` to the CURRENT AuthUser (via Better
 * Auth updatePhoneNumber), then sync the canonical domain User.phoneNumber. Same
 * AuthUser + same BARQ User; no new identity, no re-parent. Wrong/expired OTP →
 * INVALID_OTP, no mutation. A phone taken by another account → ACCOUNT_LINK_CONFLICT.
 */
export async function verifyPhoneLink(phoneRaw: string, code: string): Promise<PhoneLinkResult> {
  const ctx = await requireAuthCtx();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_PHONE" };
  const phone = normalized.e164;
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "INVALID_OTP" };

  if (ctx.hasPhone) return { ok: false, error: "ALREADY_HAS_PHONE" };

  const { ipKey } = await rateLimitKeys(phone);
  const verifyIp = getOtpVerifyIpRateLimit();
  if (!(await consumeRateLimit(otpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Attach to the current AuthUser (OTP verified atomically; taken phone rejected).
  try {
    await auth.api.verifyPhoneNumber({
      body: { phoneNumber: phone, code, updatePhoneNumber: true, disableSession: true },
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, error: mapPhoneApiError(error) };
  }

  // Sync the canonical domain User so User.phoneNumber reflects the linked phone.
  // The pre-check + Better Auth's PHONE_NUMBER_EXIST already excluded another owner;
  // a residual unique violation (a legacy unlinked User) maps to a generic conflict.
  try {
    await prisma.user.update({
      where: { id: ctx.barqUserId },
      data: { phoneNumber: phone, phoneNumberVerified: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "ACCOUNT_LINK_CONFLICT" };
    }
    throw error;
  }

  logger.info("auth.phone_linked", { authUserId: ctx.authUserId, phoneNumber: maskPhoneNumber(phone) });
  return { ok: true };
}

/** Map a Better Auth phone-number failure to a stable, non-leaking BARQ code. */
function mapPhoneApiError(error: unknown): PhoneLinkErrorCode {
  if (isAPIError(error)) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_OTP" || code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") return "INVALID_OTP";
    if (code === "PHONE_NUMBER_EXIST") return "ACCOUNT_LINK_CONFLICT";
    if (code === "INVALID_PHONE_NUMBER") return "INVALID_PHONE";
    if (code === "OTP_DELIVERY_UNAVAILABLE") return "OTP_DELIVERY_UNAVAILABLE";
  }
  return "UNKNOWN_ERROR";
}
