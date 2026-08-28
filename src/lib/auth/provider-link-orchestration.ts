"use server";

import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { Prisma } from "@prisma/client";
import { auth } from "./server";
import { requireAuth, UnauthenticatedError, ForbiddenError } from "./index";
import { prisma } from "@/lib/db";
import { normalizeInternationalPhone } from "@/lib/phone/normalize-international-phone";
import { classifyConvergence } from "./identity-convergence-policy";
import { loadIdentitySide as loadSide, findPhoneOwnerUserId } from "./identity-side-loader";
import { linkProviderCredential } from "./provider-credential-link";
import { convergeCustomerIdentityByPhone } from "./identity-convergence";
import {
  createProviderLinkChallenge,
  createCustomerLinkAttempt,
  loadLinkAttempt,
  verifyAndConsumeProviderProof,
  consumeCustomerLinkAttempt,
  invalidateLinkAttempt,
} from "./identity-link-proof";
import { getOtpProvider } from "@/lib/otp/get-otp-provider";
import { getOtpConfig } from "@/lib/otp/otp-config";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
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

// AUTH-PROVIDER-LINK gate 3A / 3A.2 — the dual-proof ORCHESTRATION between the phone conflict
// and the two DISTINCT terminal mutations (customer convergence vs provider credential link).
//
// 3A.2 replaces the provider branch's Better Auth verifyPhoneNumber proof with a BARQ-owned,
// purpose-/B-/P-/attempt-bound challenge (identity-link-proof.ts) that structurally cannot
// create an AuthUser or session and cannot be reused cross-purpose. The customer branch's
// mutation (convergeCustomerIdentityByPhone) is UNCHANGED; it only gains an opaque attempt
// wrapper so its public offer response is indistinguishable from the provider branch's.
//
// Contract: assess (read-only) → offer (after explicit consent; sends ONE OTP and returns an
// opaque verification attempt id for EITHER route) → complete(attemptId, code) (dual proof:
// live session = B; OTP = control of P; server re-derives P/owner/purpose/eligibility from the
// bound challenge + session — the client supplies only the opaque id + the code). Provider-
// and customer-eligible offers are externally indistinguishable; blocked/privileged cases
// collapse to a generic SUPPORT_REQUIRED with no role/owner/id leak.
//
// NOTE (gate scope): this module is NOT wired to any UI (that is gate 3B) and must not be
// invoked live with a real OTP in this gate.

export type LinkAssessmentStatus =
  | "LINK_AVAILABLE"
  | "SUPPORT_REQUIRED"
  | "NOT_APPLICABLE"
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "UNKNOWN_ERROR";

export type LinkAssessment = { status: LinkAssessmentStatus };

export type LinkOfferStatus =
  | "OWNERSHIP_VERIFICATION_REQUIRED"
  | "SUPPORT_REQUIRED"
  | "NOT_APPLICABLE"
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "RATE_LIMITED"
  | "OTP_DELIVERY_UNAVAILABLE"
  | "UNKNOWN_ERROR";

// The opaque verification attempt id is returned for BOTH eligible routes (never anything
// route-specific), so the public offer response is indistinguishable by account type.
export type LinkOffer = { status: "OWNERSHIP_VERIFICATION_REQUIRED"; attemptId: string } | { status: Exclude<LinkOfferStatus, "OWNERSHIP_VERIFICATION_REQUIRED"> };

export type LinkOutcome = "CONVERGED" | "LINK_COMPLETED_REAUTH_REQUIRED";
export type LinkCompletionError =
  | "NOT_AUTHENTICATED"
  | "INVALID_CHALLENGE" // unknown / not-yours / expired attempt
  | "INVALID_OTP" // wrong code / attempts exhausted / already consumed
  | "RATE_LIMITED"
  | "SUPPORT_REQUIRED" // owner substitution / topology / engine fail-closed (generic, no leak)
  | "UNKNOWN_ERROR";
export type LinkCompletion = { ok: true; outcome: LinkOutcome } | { ok: false; error: LinkCompletionError };

type Me = { userId: string; authUserId: string };

async function currentIdentity(): Promise<Me | { error: "NOT_AUTHENTICATED" }> {
  try {
    const { authUserId, barqUser } = await requireAuth();
    return { userId: barqUser.id, authUserId };
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) return { error: "NOT_AUTHENTICATED" };
    throw error;
  }
}

type LinkRoute =
  | { route: "CUSTOMER" }
  | { route: "PROVIDER"; ownerUserId: string; ownerAuthUserId: string }
  | { route: "SUPPORT"; reason: string }
  | { route: "NOT_APPLICABLE" };

/** Read-only routing from the (session B, owner-of-P) pair. PROVIDER only when the classifier
 *  says PROVIDER_CREDENTIAL_LINK with the OWNER as survivor and the owner still verifiably
 *  owns P — the same facts re-asserted at completion and again inside the gate-2 transaction. */
async function routeFor(me: Me, phone: string): Promise<LinkRoute> {
  const ownerUserId = await findPhoneOwnerUserId(prisma, phone);
  if (!ownerUserId || ownerUserId === me.userId) return { route: "NOT_APPLICABLE" };

  const [current, owner] = await Promise.all([loadSide(prisma, me.userId), loadSide(prisma, ownerUserId)]);
  if (!current || !owner) return { route: "SUPPORT", reason: "LOAD_FAILED" };

  const decision = classifyConvergence(current, owner);
  if (decision.kind === "CUSTOMER_CONVERGENCE") return { route: "CUSTOMER" };
  if (
    decision.kind === "PROVIDER_CREDENTIAL_LINK" &&
    decision.survivor.userId === owner.userId &&
    owner.authPhone === phone &&
    owner.authPhoneVerified
  ) {
    return { route: "PROVIDER", ownerUserId, ownerAuthUserId: owner.authUserId };
  }
  const reason = decision.kind === "PROVIDER_CREDENTIAL_LINK" ? "PROVIDER_TOPOLOGY_MISMATCH" : decision.reason;
  return { route: "SUPPORT", reason };
}

function logSupport(reason: string, phone: string) {
  logger.warn("auth.identity_link_assessment", { reason, phoneNumber: maskPhoneNumber(phone) });
}

function writeAudit(action: string, me: Me, extra: Prisma.InputJsonObject) {
  return recordAuditEvent(
    { actorType: "CUSTOMER", actorId: me.userId, action, entityType: "User", entityId: me.userId, newValue: extra },
    prisma
  );
}

/**
 * Step 1 — read-only assessment. Sends NO OTP and mutates nothing. LINK_AVAILABLE for BOTH an
 * eligible customer convergence AND an eligible provider credential link (indistinguishable);
 * generic SUPPORT_REQUIRED when owned-but-unsafe; NOT_APPLICABLE when P is unowned.
 */
export async function assessIdentityLink(phoneRaw: string): Promise<LinkAssessment> {
  const me = await currentIdentity();
  if ("error" in me) return { status: "NOT_AUTHENTICATED" };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { status: "INVALID_PHONE" };
  const phone = normalized.e164;

  const routed = await routeFor(me, phone);
  switch (routed.route) {
    case "NOT_APPLICABLE":
      return { status: "NOT_APPLICABLE" };
    case "CUSTOMER":
    case "PROVIDER":
      return { status: "LINK_AVAILABLE" };
    case "SUPPORT":
      logSupport(routed.reason, phone);
      return { status: "SUPPORT_REQUIRED" };
  }
}

// Provider-link send protections. The provider branch sends its OWN OTP (bypassing Better
// Auth's send hook), so it must re-apply the same durable abuse controls the hook applies to
// /phone-number/send-otp, plus a per-B ceiling. All keys are HMAC/opaque (no raw PII).
async function applyProviderSendLimits(me: Me, phone: string): Promise<boolean> {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const ipKey = hmacRateLimitKey(resolveClientIp(await headers()), secret);
  const phoneKey = hmacRateLimitKey(phone, secret);
  const { resendCooldownSeconds, maxSendsPerDay } = getOtpConfig();
  const sendIp = getOtpSendIpRateLimit();
  const sendPhone = getOtpSendPhoneRateLimit();

  // Cheap per-phone cooldown + per-B daily ceiling first, then the shared durable per-IP /
  // per-phone caps (same keys/budget as the Better Auth send path). Fail-closed on any error.
  const cooldown = await consumeRateLimit(`identity-link:send:cooldown:${phoneKey}`, 1, resendCooldownSeconds);
  if (!cooldown.allowed) return false;
  const perUser = await consumeRateLimit(`identity-link:send:user:${me.userId}`, maxSendsPerDay, 86400);
  if (!perUser.allowed) return false;
  const ipSend = await consumeRateLimit(otpSendIpKey(ipKey), sendIp.limit, sendIp.windowSeconds);
  if (!ipSend.allowed) return false;
  const phoneSend = await consumeRateLimit(otpSendPhoneKey(phoneKey), sendPhone.limit, sendPhone.windowSeconds);
  if (!phoneSend.allowed) return false;
  return true;
}

/**
 * Step 2 (offer) — after the caller's EXPLICIT consent. Re-routes fail-closed and, if eligible,
 * creates a bound challenge, sends ONE OTP, and returns an opaque attempt id (for EITHER route,
 * so account type is not enumerable). This is the only place an OTP is sent to the conflicted
 * number. For the provider route the OTP is BARQ-owned (identity-link-proof); for the customer
 * route it is Better Auth's, verified later by the unchanged convergence delegate.
 */
export async function offerIdentityLink(phoneRaw: string): Promise<LinkOffer> {
  const me = await currentIdentity();
  if ("error" in me) return { status: "NOT_AUTHENTICATED" };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { status: "INVALID_PHONE" };
  const phone = normalized.e164;

  const routed = await routeFor(me, phone);
  if (routed.route === "NOT_APPLICABLE") return { status: "NOT_APPLICABLE" };
  if (routed.route === "SUPPORT") {
    await writeAudit("identity.link_blocked", me, { reason: routed.reason });
    logSupport(routed.reason, phone);
    return { status: "SUPPORT_REQUIRED" };
  }

  if (routed.route === "PROVIDER") {
    if (!(await applyProviderSendLimits(me, phone))) return { status: "RATE_LIMITED" };
    const { challengeId, code } = await createProviderLinkChallenge({
      currentUserId: me.userId,
      phone,
      ownerAuthUserId: routed.ownerAuthUserId,
    });
    try {
      await getOtpProvider().send({ phoneNumber: phone, code });
    } catch {
      // The OTP never reached the user — the challenge must not remain usable.
      await invalidateLinkAttempt(challengeId);
      logger.warn("auth.identity_link_send_failed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
      return { status: "OTP_DELIVERY_UNAVAILABLE" };
    }
    await writeAudit("identity.link_offered", me, { phone: maskPhoneNumber(phone), route: "PROVIDER" });
    logger.info("auth.identity_link_offered", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
    return { status: "OWNERSHIP_VERIFICATION_REQUIRED", attemptId: challengeId };
  }

  // CUSTOMER route: Better Auth sends the OTP (its own send hook applies the rate limits); the
  // attempt row is only an opaque, B/P-bound wrapper so the public response matches PROVIDER.
  const { challengeId } = await createCustomerLinkAttempt({ currentUserId: me.userId, phone });
  try {
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone }, headers: await headers() });
  } catch (error) {
    await invalidateLinkAttempt(challengeId);
    if (isAPIError(error)) {
      const code = (error.body as { code?: string } | undefined)?.code;
      if (code === "TOO_MANY_REQUESTS") return { status: "RATE_LIMITED" };
      if (code === "OTP_DELIVERY_UNAVAILABLE") return { status: "OTP_DELIVERY_UNAVAILABLE" };
    }
    return { status: "UNKNOWN_ERROR" };
  }
  await writeAudit("identity.link_offered", me, { phone: maskPhoneNumber(phone), route: "CUSTOMER" });
  logger.info("auth.identity_link_offered", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
  return { status: "OWNERSHIP_VERIFICATION_REQUIRED", attemptId: challengeId };
}

/**
 * Step 3 (complete) — dual proof + terminal mutation. Proof #1 is the live session (B, never
 * client-supplied). Proof #2 is the OTP, verified against the opaque bound challenge. The phone,
 * owner, purpose and eligibility are re-derived server-side from the challenge + session; the
 * client submits only the attempt id and the code. No auth.api.verifyPhoneNumber for the
 * provider branch. Every terminal mutation independently re-asserts its invariants.
 */
export async function completeIdentityLink(attemptId: string, code: string): Promise<LinkCompletion> {
  const me = await currentIdentity();
  if ("error" in me) return { ok: false, error: "NOT_AUTHENTICATED" };
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "INVALID_OTP" };

  const loaded = await loadLinkAttempt(attemptId, me.userId);
  if (!loaded.ok) return { ok: false, error: "INVALID_CHALLENGE" }; // NOT_FOUND / WRONG_B / EXPIRED — generic

  if (loaded.purpose === "CUSTOMER_CONVERGENCE") {
    // Delegate to the unchanged customer-convergence action (its own per-IP verify limit + OTP
    // verify + atomic transaction + audit). One OTP consumption; attempt row is cleaned up.
    const result = mapCustomerResult(await convergeCustomerIdentityByPhone(loaded.phone, code));
    if (result.ok) await consumeCustomerLinkAttempt(attemptId);
    return result;
  }

  // PROVIDER route.
  // Per-IP verify rate-limit (mirror of the customer path / the /phone-number/verify hook).
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const ipKey = hmacRateLimitKey(resolveClientIp(await headers()), secret);
  const verifyIp = getOtpVerifyIpRateLimit();
  if (!(await consumeRateLimit(otpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Verify the OTP against the bound challenge and ATOMICALLY consume it (single-use even if the
  // downstream transaction later fails). No user/session/ownership mutation is possible here.
  const proof = await verifyAndConsumeProviderProof({ challengeId: attemptId, code, otpHash: loaded.otpHash });
  if (!proof.ok) {
    // INVALID_OTP / TOO_MANY_ATTEMPTS / ALREADY_CONSUMED → one generic proof-failure code.
    logger.warn("auth.identity_link_proof_failed", { authUserId: me.authUserId, reason: proof.reason });
    return { ok: false, error: "INVALID_OTP" };
  }
  await writeAudit("identity.link_proof_verified", me, { phone: maskPhoneNumber(loaded.phone) });

  // Owner-substitution + eligibility re-assert (defense in depth; the gate-2 engine re-asserts
  // again in-tx). If P became unowned, changed owner (A→C), or is no longer a provider-link,
  // fail closed generically — the consumed challenge is spent (user requests a fresh one).
  const ownerUserId = await findPhoneOwnerUserId(prisma, loaded.phone);
  if (!ownerUserId) return { ok: false, error: "SUPPORT_REQUIRED" };
  const [current, owner] = await Promise.all([loadSide(prisma, me.userId), loadSide(prisma, ownerUserId)]);
  if (!current || !owner || owner.authUserId !== loaded.ownerAuthUserId) return { ok: false, error: "SUPPORT_REQUIRED" };
  const decision = classifyConvergence(current, owner);
  if (decision.kind !== "PROVIDER_CREDENTIAL_LINK" || decision.survivor.userId !== owner.userId) {
    return { ok: false, error: "SUPPORT_REQUIRED" };
  }

  const result = await linkProviderCredential(me.userId, loaded.phone);
  if (!result.ok) {
    // Every engine error collapses to one generic reason (no topology/role leak); logged internally.
    await writeAudit("identity.link_failed", me, { code: result.error });
    logger.warn("auth.identity_link_failed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(loaded.phone) });
    return { ok: false, error: "SUPPORT_REQUIRED" };
  }
  // B is retired + its sessions killed by the engine; there is NO A session. The caller must
  // re-authenticate as A — we never silently switch/impersonate A.
  logger.info("auth.identity_link_completed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(loaded.phone) });
  return { ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" };
}

function mapCustomerResult(result: { ok: true } | { ok: false; error: string }): LinkCompletion {
  if (result.ok) return { ok: true, outcome: "CONVERGED" };
  const map: Record<string, LinkCompletionError> = {
    NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
    INVALID_PHONE: "SUPPORT_REQUIRED", // phone is server-bound, not client input
    INVALID_OTP: "INVALID_OTP",
    RATE_LIMITED: "RATE_LIMITED",
    SUPPORT_REQUIRED: "SUPPORT_REQUIRED",
    NOTHING_TO_CONVERGE: "SUPPORT_REQUIRED",
  };
  return { ok: false, error: map[result.error] ?? "UNKNOWN_ERROR" };
}
