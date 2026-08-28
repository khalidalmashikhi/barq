"use server";

import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { Prisma, UserStatus } from "@prisma/client";
import { auth } from "./server";
import { requireAuth, UnauthenticatedError, ForbiddenError } from "./index";
import { prisma } from "@/lib/db";
import { normalizeInternationalPhone } from "@/lib/phone/normalize-international-phone";
import { assessEligibility, hasRealVerifiedEmail, classifyConvergence, type IdentitySide } from "./identity-convergence-policy";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { resolveClientIp, hmacRateLimitKey } from "@/lib/rate-limit/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit/durable-rate-limiter";
import { getOtpVerifyIpRateLimit, otpVerifyIpKey } from "@/lib/otp/otp-rate-limit-config";
import { maskPhoneNumber } from "@/lib/otp/audit";
import { logger } from "@/lib/logger";

// AUTH-IDENTITY-CONVERGENCE-1 — safe, dual-proof convergence of a customer's
// email-first and phone-first identities into ONE canonical BARQ identity.
//
// This is NOT a generic account-merge engine. It only fires when an authenticated
// CUSTOMER (identity B, whose live session is proof of B) tries to add a phone P that
// already belongs to another identity A, AND both sides are provably ordinary
// Customer-only identities where safe re-parenting can be proven (see the pure policy
// in identity-convergence-policy.ts). Anything else fails closed to SUPPORT_REQUIRED.
//
// Dual proof: (1) the live session proves control of B; (2) a fresh Phone OTP on P
// proves control of P/A. The OTP is verified with `disableSession: true` so proving P
// never signs the caller in as A and never attaches P to B — it only consumes the OTP
// (single-use, anti-replay) and idempotently re-marks A's already-verified flag. The
// credential transfer itself is a BARQ-owned atomic Prisma transaction: Better Auth
// 1.6.23 has no cross-user credential-move primitive (updatePhoneNumber throws
// PHONE_NUMBER_EXIST on a taken phone).
//
// Security invariants: never transfers or creates Provider/Staff/Admin; never merges
// two identities that both hold meaningful transactional history; never deletes the
// loser (retained + DEACTIVATED, sessions invalidated); never leaks the other
// account's PII in any returned state. See AUTH-PHONE-LINK-CONFLICT-DIAG-1.

export type ConvergenceOfferStatus =
  | "OWNERSHIP_VERIFICATION_REQUIRED" // eligible; a proof OTP was sent to P
  | "SUPPORT_REQUIRED" // owned by another, but not safely auto-convergeable
  | "NOT_APPLICABLE" // P is not owned by another identity (caller handles normally)
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "RATE_LIMITED"
  | "OTP_DELIVERY_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export type ConvergenceOffer = { status: ConvergenceOfferStatus };

export type ConvergenceAssessmentStatus =
  | "CONVERGENCE_AVAILABLE" // eligible; the caller may present the choice then send the proof OTP
  | "SUPPORT_REQUIRED" // owned by another, but not safely auto-convergeable
  | "NOT_APPLICABLE" // P is not owned by another identity
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "UNKNOWN_ERROR";

export type ConvergenceAssessment = { status: ConvergenceAssessmentStatus };

export type ConvergeErrorCode =
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "INVALID_OTP"
  | "RATE_LIMITED"
  | "SUPPORT_REQUIRED"
  | "NOTHING_TO_CONVERGE"
  | "UNKNOWN_ERROR";

export type ConvergeResult = { ok: true } | { ok: false; error: ConvergeErrorCode };

type DbClient = typeof prisma | Prisma.TransactionClient;

class ConvergenceAbort extends Error {
  constructor(public code: ConvergeErrorCode) {
    super(code);
  }
}

/** The domain User id that owns `phone` (via the AuthUser credential, else a legacy User row). */
async function findPhoneOwnerUserId(db: DbClient, phone: string): Promise<string | null> {
  const authOwner = await db.authUser.findUnique({
    where: { phoneNumber: phone },
    select: { barqUser: { select: { id: true } } },
  });
  if (authOwner?.barqUser) return authOwner.barqUser.id;
  const userOwner = await db.user.findUnique({ where: { phoneNumber: phone }, select: { id: true } });
  return userOwner?.id ?? null;
}

/** Load one identity side (User + AuthUser + eligibility signals), or null if incomplete. */
async function loadSide(db: DbClient, userId: string): Promise<IdentitySide | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      authUser: true,
      providerLink: { select: { id: true } },
      staff: { select: { id: true } },
      admin: { select: { id: true } },
      customer: {
        select: {
          id: true,
          wallet: { select: { id: true } },
          _count: { select: { bookings: true, reviews: true, contracts: true, supportTickets: true } },
        },
      },
    },
  });
  if (!user || !user.authUser) return null;
  const c = user.customer;
  const hasMeaningfulHistory =
    c !== null &&
    (c._count.bookings > 0 || c._count.reviews > 0 || c._count.contracts > 0 || c._count.supportTickets > 0 || c.wallet !== null);
  return {
    userId: user.id,
    authUserId: user.authUser.id,
    status: user.status,
    createdAt: user.createdAt,
    userPhone: user.phoneNumber,
    authEmail: user.authUser.email,
    authEmailVerified: user.authUser.emailVerified,
    authPhone: user.authUser.phoneNumber,
    authPhoneVerified: user.authUser.phoneNumberVerified,
    hasPrivilege: user.providerLink !== null || user.staff !== null || user.admin !== null,
    hasProvider: user.providerLink !== null,
    hasStaffOrAdmin: user.staff !== null || user.admin !== null,
    hasCustomer: user.customer !== null,
    customerId: c?.id ?? null,
    hasMeaningfulHistory,
  };
}

async function currentIdentity(): Promise<{ userId: string; authUserId: string } | { error: "NOT_AUTHENTICATED" }> {
  try {
    const { authUserId, barqUser } = await requireAuth();
    return { userId: barqUser.id, authUserId };
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) return { error: "NOT_AUTHENTICATED" };
    throw error;
  }
}

function writeAudit(action: string, entityId: string, actorId: string | null, extra: Prisma.InputJsonObject, db: DbClient = prisma) {
  return recordAuditEvent({ actorType: "CUSTOMER", actorId, action, entityType: "User", entityId, newValue: extra }, db);
}

// AUTH-CONVERGENCE-DIAGNOSTIC-1 — an INTERNAL-ONLY, non-PII reason for why an
// assessment fail-closes to SUPPORT_REQUIRED. It is never returned to the browser and
// never changes the user-facing status or the decision path; it only makes the exact
// blocking condition observable in server logs (needed to diagnose the live staging
// pair). Exported for server-side testability.
export type AssessmentDiagnosticReason =
  | "CURRENT_SIDE_LOAD_FAILED"
  | "OWNER_SIDE_LOAD_FAILED"
  | "LEGACY_OWNER_NO_AUTHUSER"
  | "OWNER_TOPOLOGY_MISMATCH"
  // AUTH-PROVIDER-LINK gate 1 — classification outcomes (internal only). A Provider-only
  // owner + safe ordinary B is now recognised as PROVIDER_CREDENTIAL_LINK_AVAILABLE
  // (public status stays SUPPORT_REQUIRED until the link operation ships in a later gate).
  | "PROVIDER_CREDENTIAL_LINK_AVAILABLE"
  | "STAFF_ADMIN_BLOCKED"
  | "CURRENT_PRIVILEGED"
  | "CURRENT_HISTORY_UNSAFE"
  | "OWNER_NOT_LINKABLE"
  | "BOTH_HISTORY"
  | "NOT_CUSTOMER"
  | "SAME_IDENTITY"
  | "NOT_ELIGIBLE"
  | "UNKNOWN_FAIL_CLOSED";

// Read-only re-inspection of WHY loadSide returned null for a side — never mutates and
// never changes the (already-SUPPORT_REQUIRED) decision. loadSide yields null only when
// a User is missing or has no AuthUser bridge; this separates those cases.
async function diagnoseLoadFailure(currentUserId: string, ownerUserId: string): Promise<AssessmentDiagnosticReason> {
  const cur = await prisma.user.findUnique({ where: { id: currentUserId }, select: { authUserId: true } });
  if (!cur || cur.authUserId === null) return "CURRENT_SIDE_LOAD_FAILED";
  const own = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { authUserId: true } });
  if (!own) return "OWNER_SIDE_LOAD_FAILED";
  // The prime legacy case: a historical User with a verified phone but no AuthUser bridge.
  if (own.authUserId === null) return "LEGACY_OWNER_NO_AUTHUSER";
  // A bridge id is set yet loadSide's authUser relation came back null → a dangling /
  // inconsistent AuthUser bridge; never auto-converge across it.
  return "OWNER_TOPOLOGY_MISMATCH";
}

/**
 * Read-only assessment: is safe dual-proof convergence AVAILABLE for phone P? Sends NO
 * OTP and mutates nothing — it exists so the UI can present an explicit choice (verify
 * + converge / use a different number / cancel) BEFORE any OTP is sent to a number that
 * belongs to another identity. CONVERGENCE_AVAILABLE when eligible; a generic
 * SUPPORT_REQUIRED when owned-but-unsafe (no PII); NOT_APPLICABLE when P is not owned by
 * another identity (the normal Add-phone flow handles it). On any SUPPORT_REQUIRED it
 * logs an internal-only, non-PII diagnostic reason (never returned to the browser).
 */
export async function assessIdentityConvergence(phoneRaw: string): Promise<ConvergenceAssessment> {
  const me = await currentIdentity();
  if ("error" in me) return { status: "NOT_AUTHENTICATED" };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { status: "INVALID_PHONE" };
  const phone = normalized.e164;

  const ownerUserId = await findPhoneOwnerUserId(prisma, phone);
  if (!ownerUserId || ownerUserId === me.userId) return { status: "NOT_APPLICABLE" };

  const [current, owner] = await Promise.all([loadSide(prisma, me.userId), loadSide(prisma, ownerUserId)]);
  if (!current || !owner) {
    const reason = await diagnoseLoadFailure(me.userId, ownerUserId);
    logger.warn("auth.identity_convergence_assessment", { reason, phoneNumber: maskPhoneNumber(phone) });
    return { status: "SUPPORT_REQUIRED" };
  }

  // AUTH-PROVIDER-LINK gate 1 — classify (customer-convergence vs provider credential
  // link vs support). PUBLIC behavior is unchanged: only a CUSTOMER_CONVERGENCE is
  // offered (CONVERGENCE_AVAILABLE); a PROVIDER_CREDENTIAL_LINK is recognised INTERNALLY
  // but still returns the generic SUPPORT_REQUIRED (the link operation + UX ship later).
  const decision = classifyConvergence(current, owner);
  if (decision.kind === "CUSTOMER_CONVERGENCE") return { status: "CONVERGENCE_AVAILABLE" };
  const reason: AssessmentDiagnosticReason =
    decision.kind === "PROVIDER_CREDENTIAL_LINK" ? "PROVIDER_CREDENTIAL_LINK_AVAILABLE" : decision.reason;
  logger.warn("auth.identity_convergence_assessment", { reason, phoneNumber: maskPhoneNumber(phone) });
  return { status: "SUPPORT_REQUIRED" };
}

/**
 * Step 2 (offer): the customer chose to verify ownership and converge. Re-assess
 * (fail-closed) and, if still eligible, send the proof OTP to P and return
 * OWNERSHIP_VERIFICATION_REQUIRED; otherwise a generic SUPPORT_REQUIRED (no PII).
 * NON-conflict inputs return NOT_APPLICABLE. This is the ONLY place an OTP is sent to
 * the conflicted number, and only after the customer's explicit consent.
 */
export async function offerIdentityConvergence(phoneRaw: string): Promise<ConvergenceOffer> {
  const me = await currentIdentity();
  if ("error" in me) return { status: "NOT_AUTHENTICATED" };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { status: "INVALID_PHONE" };
  const phone = normalized.e164;

  const ownerUserId = await findPhoneOwnerUserId(prisma, phone);
  if (!ownerUserId || ownerUserId === me.userId) return { status: "NOT_APPLICABLE" };

  const [current, owner] = await Promise.all([loadSide(prisma, me.userId), loadSide(prisma, ownerUserId)]);
  if (!current || !owner) {
    await writeAudit("identity.convergence_blocked", me.userId, me.userId, { reason: "AMBIGUOUS" });
    logger.warn("auth.identity_convergence_blocked", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
    return { status: "SUPPORT_REQUIRED" };
  }

  const elig = assessEligibility(current, owner);
  if (!elig.eligible) {
    await writeAudit("identity.convergence_blocked", me.userId, me.userId, { reason: elig.reason });
    logger.warn("auth.identity_convergence_blocked", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
    return { status: "SUPPORT_REQUIRED" };
  }

  // Eligible: send the ownership-proof OTP through the normal provider (its own
  // rate-limit + delivery hooks apply). Reveal nothing about the other identity.
  try {
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone }, headers: await headers() });
  } catch (error) {
    if (isAPIError(error)) {
      const code = (error.body as { code?: string } | undefined)?.code;
      if (code === "TOO_MANY_REQUESTS") return { status: "RATE_LIMITED" };
      if (code === "OTP_DELIVERY_UNAVAILABLE") return { status: "OTP_DELIVERY_UNAVAILABLE" };
    }
    return { status: "UNKNOWN_ERROR" };
  }

  await writeAudit("identity.convergence_started", me.userId, me.userId, { phone: maskPhoneNumber(phone) });
  logger.info("auth.identity_convergence_offered", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
  return { status: "OWNERSHIP_VERIFICATION_REQUIRED" };
}

/**
 * Step 2 (converge): verify the fresh OTP on P (proof of P/A), then run the atomic
 * transactional convergence. The live session is the proof of the current identity.
 * Fails closed on any eligibility/ownership change re-checked inside the transaction.
 */
export async function convergeCustomerIdentityByPhone(phoneRaw: string, code: string): Promise<ConvergeResult> {
  const me = await currentIdentity();
  if ("error" in me) return { ok: false, error: "NOT_AUTHENTICATED" };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_PHONE" };
  const phone = normalized.e164;
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "INVALID_OTP" };

  // Durable per-IP verify cap (mirror of link-phone / the /phone-number/verify hook).
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const ipKey = hmacRateLimitKey(resolveClientIp(await headers()), secret);
  const verifyIp = getOtpVerifyIpRateLimit();
  if (!(await consumeRateLimit(otpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Prove control of P. disableSession + no updatePhoneNumber → verifies + consumes
  // the OTP (single-use, anti-replay) WITHOUT signing us in as A or attaching P to us.
  try {
    await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code, disableSession: true }, headers: await headers() });
  } catch (error) {
    return { ok: false, error: mapVerifyError(error) };
  }

  await writeAudit("identity.convergence_second_credential_verified", me.userId, me.userId, { phone: maskPhoneNumber(phone) });

  try {
    await prisma.$transaction(async (tx) => {
      const ownerUserId = await findPhoneOwnerUserId(tx, phone);
      if (!ownerUserId) throw new ConvergenceAbort("NOTHING_TO_CONVERGE");
      if (ownerUserId === me.userId) throw new ConvergenceAbort("NOTHING_TO_CONVERGE");

      const [current, owner] = await Promise.all([loadSide(tx, me.userId), loadSide(tx, ownerUserId)]);
      if (!current || !owner) throw new ConvergenceAbort("SUPPORT_REQUIRED");

      // Re-assert the phone is still verified-owned by A, then re-assert eligibility.
      if (owner.authPhone !== phone || !owner.authPhoneVerified) throw new ConvergenceAbort("SUPPORT_REQUIRED");
      const elig = assessEligibility(current, owner);
      if (!elig.eligible) throw new ConvergenceAbort("SUPPORT_REQUIRED");
      const { survivor, loser } = elig;

      const movedPhone = survivor.authPhone !== phone; // phone lives on the loser → move it
      const movedEmail = !hasRealVerifiedEmail(survivor); // real email lives on the loser → move it

      // Transfer the phone credential (release from loser BEFORE claiming on survivor
      // so neither unique index — AuthUser.phoneNumber / User.phoneNumber — is ever
      // double-held).
      if (movedPhone) {
        await tx.authUser.update({ where: { id: loser.authUserId }, data: { phoneNumber: null, phoneNumberVerified: false } });
        await tx.user.updateMany({
          where: { id: loser.userId, phoneNumber: phone },
          data: { phoneNumber: null, phoneNumberVerified: false },
        });
        await tx.authUser.update({ where: { id: survivor.authUserId }, data: { phoneNumber: phone, phoneNumberVerified: true } });
        await tx.user.update({ where: { id: survivor.userId }, data: { phoneNumber: phone, phoneNumberVerified: true } });
      }

      // Transfer the real email credential if the survivor lacks one.
      if (movedEmail) {
        if (!hasRealVerifiedEmail(loser)) throw new ConvergenceAbort("SUPPORT_REQUIRED");
        const realEmail = loser.authEmail as string;
        await tx.authUser.update({ where: { id: loser.authUserId }, data: { email: null, emailVerified: false } });
        await tx.authUser.update({ where: { id: survivor.authUserId }, data: { email: realEmail, emailVerified: true } });
      }

      // Re-parent the loser's social accounts + notifications to the survivor.
      await tx.account.updateMany({ where: { userId: loser.authUserId }, data: { userId: survivor.authUserId } });
      await tx.notification.updateMany({ where: { userId: loser.userId }, data: { userId: survivor.userId } });

      // Retain (never delete) the loser: DEACTIVATED, with every session invalidated so
      // the transferred credential can never resolve to the abandoned identity again.
      await tx.user.update({ where: { id: loser.userId }, data: { status: UserStatus.DEACTIVATED } });
      await tx.session.deleteMany({ where: { userId: loser.authUserId } });

      await writeAudit(
        "identity.convergence_completed",
        survivor.userId,
        survivor.customerId,
        { survivorUserId: survivor.userId, loserUserId: loser.userId, movedPhone, movedEmail, currentWasSurvivor: survivor.userId === me.userId },
        tx
      );
    });
  } catch (error) {
    if (error instanceof ConvergenceAbort) {
      await writeAudit("identity.convergence_failed", me.userId, me.userId, { code: error.code });
      logger.warn("auth.identity_convergence_failed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
      return { ok: false, error: error.code };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await writeAudit("identity.convergence_failed", me.userId, me.userId, { code: "UNIQUE_RACE" });
      logger.warn("auth.identity_convergence_failed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
      return { ok: false, error: "SUPPORT_REQUIRED" };
    }
    throw error;
  }

  logger.info("auth.identity_convergence_completed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
  return { ok: true };
}

/** Map a Better Auth phone-verify failure to a stable, non-leaking BARQ code. */
function mapVerifyError(error: unknown): ConvergeErrorCode {
  if (isAPIError(error)) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_OTP" || code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") return "INVALID_OTP";
    if (code === "TOO_MANY_REQUESTS") return "RATE_LIMITED";
    if (code === "INVALID_PHONE_NUMBER") return "INVALID_PHONE";
  }
  return "INVALID_OTP";
}
