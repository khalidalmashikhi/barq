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
import { linkProviderCredential, type ProviderLinkError } from "./provider-credential-link";
import { convergeCustomerIdentityByPhone } from "./identity-convergence";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { resolveClientIp, hmacRateLimitKey } from "@/lib/rate-limit/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit/durable-rate-limiter";
import { getOtpVerifyIpRateLimit, otpVerifyIpKey } from "@/lib/otp/otp-rate-limit-config";
import { maskPhoneNumber } from "@/lib/otp/audit";
import { logger } from "@/lib/logger";

// AUTH-PROVIDER-LINK gate 3A — the DUAL-PROOF ORCHESTRATION that sits between the phone
// conflict and the two DISTINCT terminal mutations:
//   • customer convergence  → convergeCustomerIdentityByPhone (unchanged, proven)
//   • provider credential link → linkProviderCredential (gate-2 engine)
//
// It is a thin, security-first coordinator. It owns NO credential mutation of its own; it
// only (1) assesses eligibility, (2) — after the caller's EXPLICIT consent, modelled as a
// separate offer() call — sends ONE fresh phone OTP to the conflicted number, (3) verifies
// that OTP WITHOUT switching identity/session, and (4) invokes the correct terminal
// mutation. Every identity/topology decision is server-derived from the live session; the
// client supplies only a phone and (to complete) an OTP.
//
// Dual proof: (proof #1) the authenticated live session proves control of the CURRENT
// identity B — re-resolved from the session on every call, NEVER taken from client input;
// (proof #2) a fresh single-use Phone OTP on the conflicted number P proves control of the
// owner A. The OTP is verified with `disableSession: true` and no `updatePhoneNumber`, so
// (verified against better-auth@1.6.23 phone-number/routes.mjs) proving P: creates NO
// session for A, sets NO cookie, leaves B's session untouched, does NOT move P's ownership,
// and — because P already has an owner — does NOT take the signUpOnVerification branch, so
// no third AuthUser is created. It only consumes the OTP (single-use / expiring /
// attempt-capped) and idempotently re-marks A's already-verified flag.
//
// Anti-enumeration (§8): a provider-credential-link-eligible conflict and an ordinary
// customer-convergence-eligible conflict are EXTERNALLY INDISTINGUISHABLE at the
// conflict/consent stage — both return LINK_AVAILABLE from assess and
// OWNERSHIP_VERIFICATION_REQUIRED from offer. The public response NEVER reveals
// Provider/Staff/Admin, owner metadata, or internal ids. Blocked sensitive cases collapse
// to a generic SUPPORT_REQUIRED. Internally, the exact classification is logged (no PII).
//
// NOTE (gate 3A scope): this module is NOT wired to any UI/onboarding screen — that is
// gate 3B. It must not be invoked live with a real OTP in this gate.

export type LinkAssessmentStatus =
  | "LINK_AVAILABLE" // eligible (customer convergence OR provider credential link) — indistinguishable
  | "SUPPORT_REQUIRED" // owned by another, but not safely self-service linkable
  | "NOT_APPLICABLE" // P is not owned by another identity — normal Add-phone handles it
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "UNKNOWN_ERROR";

export type LinkAssessment = { status: LinkAssessmentStatus };

export type LinkOfferStatus =
  | "OWNERSHIP_VERIFICATION_REQUIRED" // eligible; a proof OTP was sent to P
  | "SUPPORT_REQUIRED"
  | "NOT_APPLICABLE"
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "RATE_LIMITED"
  | "OTP_DELIVERY_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export type LinkOffer = { status: LinkOfferStatus };

export type LinkOutcome =
  | "CONVERGED" // customer convergence completed (session may remain valid)
  | "LINK_COMPLETED_REAUTH_REQUIRED"; // provider link completed; B retired + sessions killed → re-auth as A

export type LinkCompletionError =
  | "NOT_AUTHENTICATED"
  | "INVALID_PHONE"
  | "INVALID_OTP"
  | "RATE_LIMITED"
  | "SUPPORT_REQUIRED"
  | "NOTHING_TO_LINK"
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
  | { route: "PROVIDER"; ownerUserId: string }
  | { route: "SUPPORT"; reason: string }
  | { route: "NOT_APPLICABLE" };

/**
 * Read-only routing: which safe operation (if any) applies to the (session B, owner-of-P)
 * pair? Never mutates and never sends an OTP. PROVIDER is returned only when the classifier
 * says PROVIDER_CREDENTIAL_LINK with the OWNER as survivor (so B can never be the survivor)
 * AND the owner still verifiably owns P — the same facts re-asserted again inside the
 * gate-2 transaction.
 */
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
    return { route: "PROVIDER", ownerUserId };
  }
  const reason = decision.kind === "PROVIDER_CREDENTIAL_LINK" ? "PROVIDER_TOPOLOGY_MISMATCH" : decision.reason;
  return { route: "SUPPORT", reason };
}

function logSupport(reason: string, phone: string) {
  logger.warn("auth.identity_link_assessment", { reason, phoneNumber: maskPhoneNumber(phone) });
}

function writeAudit(action: string, me: Me, extra: Prisma.InputJsonObject) {
  return recordAuditEvent(
    {
      actorType: "CUSTOMER",
      actorId: me.userId,
      action,
      entityType: "User",
      entityId: me.userId,
      newValue: extra,
    },
    prisma
  );
}

/**
 * Step 1 — read-only assessment. Sends NO OTP and mutates nothing. Returns LINK_AVAILABLE
 * for BOTH an eligible customer convergence and an eligible provider credential link
 * (indistinguishable); a generic SUPPORT_REQUIRED when owned-but-unsafe; NOT_APPLICABLE
 * when P is not owned by another identity. On SUPPORT_REQUIRED it logs an internal-only,
 * non-PII reason (never returned to the browser).
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

/**
 * Step 2 (offer) — the caller EXPLICITLY consented to prove ownership and link. Re-route
 * (fail-closed) and, if still eligible (either operation), send ONE proof OTP to P and
 * return OWNERSHIP_VERIFICATION_REQUIRED; otherwise a generic SUPPORT_REQUIRED (no PII).
 * This is the ONLY place an OTP is sent to the conflicted number, and only after consent.
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

  // Eligible (CUSTOMER or PROVIDER): send the ownership-proof OTP through the normal
  // provider (its own rate-limit + delivery hooks apply). Reveal nothing about the owner.
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

  await writeAudit("identity.link_offered", me, { phone: maskPhoneNumber(phone), route: routed.route });
  logger.info("auth.identity_link_offered", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
  return { status: "OWNERSHIP_VERIFICATION_REQUIRED" };
}

/**
 * Step 3 (complete) — dual proof + the terminal mutation. Proof #1 is the live session
 * (re-resolved here, never client-supplied). Proof #2 is the fresh OTP on P. The route is
 * re-derived server-side and each terminal mutation independently re-asserts every
 * invariant (customer convergence in its own transaction; provider link in the gate-2
 * transaction) — assessment is never authorization.
 */
export async function completeIdentityLink(phoneRaw: string, code: string): Promise<LinkCompletion> {
  const me = await currentIdentity();
  if ("error" in me) return { ok: false, error: "NOT_AUTHENTICATED" };

  const normalized = normalizeInternationalPhone(phoneRaw);
  if (!normalized.ok) return { ok: false, error: "INVALID_PHONE" };
  const phone = normalized.e164;
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "INVALID_OTP" };

  const routed = await routeFor(me, phone);

  if (routed.route === "NOT_APPLICABLE") return { ok: false, error: "NOTHING_TO_LINK" };
  if (routed.route === "SUPPORT") {
    // No OTP was consumed — no verification is performed for an ineligible pair.
    logSupport(routed.reason, phone);
    return { ok: false, error: "SUPPORT_REQUIRED" };
  }

  if (routed.route === "CUSTOMER") {
    // Delegate to the proven, unchanged customer-convergence action (its own per-IP verify
    // rate-limit + OTP verify + atomic transaction + audit). One OTP consumption.
    return mapCustomerResult(await convergeCustomerIdentityByPhone(phone, code));
  }

  // PROVIDER credential link.
  // Per-IP verify rate-limit (mirror of the customer path / the /phone-number/verify hook).
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const ipKey = hmacRateLimitKey(resolveClientIp(await headers()), secret);
  const verifyIp = getOtpVerifyIpRateLimit();
  if (!(await consumeRateLimit(otpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds)).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Prove control of P. disableSession + no updatePhoneNumber → verifies + consumes the OTP
  // WITHOUT creating a session for A, setting any cookie, moving P, or creating a third
  // AuthUser (P has a verified Provider owner, re-asserted in routeFor immediately above and
  // again inside the transaction).
  try {
    await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code, disableSession: true }, headers: await headers() });
  } catch (error) {
    return { ok: false, error: mapVerifyError(error) };
  }

  await writeAudit("identity.link_proof_verified", me, { phone: maskPhoneNumber(phone) });

  // Terminal mutation: the gate-2 engine independently re-asserts every invariant inside
  // its own transaction and fails closed with no partial writes. Identity is server-derived
  // (me.userId from the session); the client cannot choose survivor/owner/privilege.
  const result = await linkProviderCredential(me.userId, phone);
  if (!result.ok) {
    await writeAudit("identity.link_failed", me, { code: result.error });
    logger.warn("auth.identity_link_failed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
    return { ok: false, error: mapProviderLinkError(result.error) };
  }

  // Success: B is retired and its sessions are invalidated by the engine; there is NO A
  // session. The caller must re-authenticate as A. We never silently switch/impersonate A.
  logger.info("auth.identity_link_completed", { authUserId: me.authUserId, phoneNumber: maskPhoneNumber(phone) });
  return { ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" };
}

/** Map the customer-convergence action result into the unified completion contract. */
function mapCustomerResult(result: { ok: true } | { ok: false; error: string }): LinkCompletion {
  if (result.ok) return { ok: true, outcome: "CONVERGED" };
  const map: Record<string, LinkCompletionError> = {
    NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
    INVALID_PHONE: "INVALID_PHONE",
    INVALID_OTP: "INVALID_OTP",
    RATE_LIMITED: "RATE_LIMITED",
    SUPPORT_REQUIRED: "SUPPORT_REQUIRED",
    NOTHING_TO_CONVERGE: "NOTHING_TO_LINK",
  };
  return { ok: false, error: map[result.error] ?? "UNKNOWN_ERROR" };
}

/** Map a gate-2 engine error to a non-enumerating public completion error (no topology/role leak). */
function mapProviderLinkError(error: ProviderLinkError): LinkCompletionError {
  if (error === "INVALID_PHONE") return "INVALID_PHONE";
  // OWNER_NOT_FOUND / SAME_IDENTITY / LOAD_FAILED / OWNER_PHONE_CHANGED /
  // NOT_PROVIDER_LINK_ELIGIBLE / SURVIVOR_HAS_EMAIL / LOSER_NOT_LINKABLE / UNIQUE_RACE /
  // UNKNOWN_ERROR → one generic reason. The precise code is logged internally only.
  return "SUPPORT_REQUIRED";
}

/** Map a Better Auth phone-verify failure to a stable, non-leaking BARQ code. */
function mapVerifyError(error: unknown): LinkCompletionError {
  if (isAPIError(error)) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_OTP" || code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS" || code === "OTP_NOT_FOUND")
      return "INVALID_OTP";
    if (code === "TOO_MANY_REQUESTS") return "RATE_LIMITED";
    if (code === "INVALID_PHONE_NUMBER") return "INVALID_PHONE";
  }
  return "INVALID_OTP";
}
