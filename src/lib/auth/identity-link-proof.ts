import "server-only";
import { randomInt, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getOtpConfig } from "@/lib/otp/otp-config";
import { consumeRateLimit } from "@/lib/rate-limit/durable-rate-limiter";

// AUTH-PROVIDER-LINK gate 3A.2 — a BARQ-owned, purpose- and attempt-bound phone-proof
// mechanism used ONLY by provider credential linking (and a thin, OTP-less attempt wrapper
// for the customer-convergence branch so the two public offers stay indistinguishable).
//
// WHY this exists (see gate 3A.1): Better Auth's phone OTP keys its Verification rows by the
// BARE phone number, so (1) any phone OTP is cross-purpose reusable across BARQ's phone
// flows, and (2) auth.api.verifyPhoneNumber can take its signUpOnVerification `!user` branch
// and create an orphan AuthUser. This module NEVER calls verifyPhoneNumber and NEVER touches
// users/sessions/accounts — it only reads/writes rows in the Better Auth `Verification`
// model under a DISTINCT, namespaced identifier (`identity-link:<challengeId>`) that Better
// Auth's phone flows never look up. That gives a STRUCTURAL guarantee:
//   • no AuthUser is ever created by proof verification,
//   • no session/cookie is ever created or switched,
//   • no phone ownership is ever mutated,
//   • the proof is bound to purpose + exact B + exact P + one opaque challenge, so it cannot
//     be reused cross-purpose, cross-B, or cross-attempt.
// The OTP is stored only as an HMAC (keyed by the existing BETTER_AUTH_SECRET — low-entropy
// numeric OTPs must not sit in a plain fast hash), consumed atomically (single-use), and
// capped by the same expiry/attempt policy as the rest of the app (getOtpConfig()).
//
// This is a server-only module, NOT a "use server" action — it is unreachable by clients and
// is orchestrated exclusively by provider-link-orchestration.ts.

type DbClient = typeof prisma | Prisma.TransactionClient;

export type LinkPurpose = "PROVIDER_CREDENTIAL_LINK" | "CUSTOMER_CONVERGENCE";

const IDENTIFIER_PREFIX = "identity-link:"; // namespaced away from Better Auth's bare-phone rows
const CHALLENGE_ID = /^[0-9a-f]{64}$/; // 256-bit opaque hex

function serverSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s || s.length === 0) throw new Error("identity-link-proof: BETTER_AUTH_SECRET is required");
  return s;
}

/** Cryptographically secure numeric OTP (rejection-free via crypto.randomInt — no modulo bias). */
export function generateNumericOtp(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

/** Opaque, high-entropy (256-bit) challenge id — also the Verification row PK. */
function newChallengeId(): string {
  return randomBytes(32).toString("hex");
}

function identifierFor(challengeId: string): string {
  return `${IDENTIFIER_PREFIX}${challengeId}`;
}

/** One-way verifier for the OTP, HMAC-keyed by the server secret and BOUND to the challenge id
 *  (so a stored hash can never be replayed against a different challenge). */
function hashOtp(challengeId: string, code: string): string {
  return createHmac("sha256", serverSecret()).update(`${challengeId}.${code}`).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// The persisted, server-bound challenge payload. Contains only server-derived values; the
// phone is stored (the table already stores phones for BARQ's OTP flow) so the owner can be
// re-resolved at completion — never an OTP in plaintext, never client-supplied data.
type BaseAttempt = {
  v: 1;
  purpose: LinkPurpose;
  currentUserId: string; // B — the authenticated identity at offer time
  phone: string; // P — the exact normalized E.164 this proof is bound to
};
type ProviderAttempt = BaseAttempt & {
  purpose: "PROVIDER_CREDENTIAL_LINK";
  ownerAuthUserId: string; // A — bound so owner substitution (A→C) is detectable at completion
  otpHash: string;
};
type CustomerAttempt = BaseAttempt & { purpose: "CUSTOMER_CONVERGENCE" };
type AttemptPayload = ProviderAttempt | CustomerAttempt;

function attemptKey(challengeId: string): string {
  return `identity-link:attempt:${challengeId}`;
}

/** Create a purpose-bound provider-link challenge and return the opaque id + the plaintext OTP
 *  (the caller sends the OTP via SMS and NEVER logs or returns it to the browser). */
export async function createProviderLinkChallenge(input: {
  currentUserId: string;
  phone: string;
  ownerAuthUserId: string;
}): Promise<{ challengeId: string; code: string }> {
  const challengeId = newChallengeId();
  const code = generateNumericOtp(6);
  const payload: ProviderAttempt = {
    v: 1,
    purpose: "PROVIDER_CREDENTIAL_LINK",
    currentUserId: input.currentUserId,
    phone: input.phone,
    ownerAuthUserId: input.ownerAuthUserId,
    otpHash: hashOtp(challengeId, code),
  };
  const { expiresInSeconds } = getOtpConfig();
  await prisma.verification.create({
    data: {
      id: challengeId,
      identifier: identifierFor(challengeId),
      value: JSON.stringify(payload),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    },
  });
  return { challengeId, code };
}

/** Create an OTP-less customer-convergence attempt (anti-enumeration wrapper). The OTP itself
 *  is Better Auth's, verified by the customer-convergence delegate; this only binds B + P and
 *  yields an opaque id so the public offer response matches the provider branch. */
export async function createCustomerLinkAttempt(input: {
  currentUserId: string;
  phone: string;
}): Promise<{ challengeId: string }> {
  const challengeId = newChallengeId();
  const payload: CustomerAttempt = {
    v: 1,
    purpose: "CUSTOMER_CONVERGENCE",
    currentUserId: input.currentUserId,
    phone: input.phone,
  };
  const { expiresInSeconds } = getOtpConfig();
  await prisma.verification.create({
    data: {
      id: challengeId,
      identifier: identifierFor(challengeId),
      value: JSON.stringify(payload),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    },
  });
  return { challengeId };
}

/** Hard-delete a challenge (used to invalidate on SMS-send failure — a challenge whose OTP
 *  never reached the user must not remain usable). Idempotent. */
export async function invalidateLinkAttempt(challengeId: string, db: DbClient = prisma): Promise<void> {
  if (typeof challengeId !== "string" || !CHALLENGE_ID.test(challengeId)) return;
  await db.verification.deleteMany({ where: { id: challengeId, identifier: identifierFor(challengeId) } });
}

export type LoadedAttempt =
  | { ok: true; purpose: "PROVIDER_CREDENTIAL_LINK"; phone: string; ownerAuthUserId: string; otpHash: string }
  | { ok: true; purpose: "CUSTOMER_CONVERGENCE"; phone: string }
  | { ok: false; reason: "NOT_FOUND" | "WRONG_B" | "EXPIRED" };

/** Load + bind-check a challenge WITHOUT consuming it: valid namespace, well-formed payload,
 *  belongs to the current authenticated B, and not expired. Never trusts the client for B. */
export async function loadLinkAttempt(challengeId: string, currentUserId: string): Promise<LoadedAttempt> {
  if (typeof challengeId !== "string" || !CHALLENGE_ID.test(challengeId)) return { ok: false, reason: "NOT_FOUND" };
  const row = await prisma.verification.findUnique({ where: { id: challengeId } });
  if (!row || row.identifier !== identifierFor(challengeId)) return { ok: false, reason: "NOT_FOUND" };

  let payload: AttemptPayload;
  try {
    payload = JSON.parse(row.value) as AttemptPayload;
  } catch {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (payload.v !== 1 || (payload.purpose !== "PROVIDER_CREDENTIAL_LINK" && payload.purpose !== "CUSTOMER_CONVERGENCE")) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  // Bind to the current session's B — a challenge minted for one B can never be used by another.
  if (payload.currentUserId !== currentUserId) return { ok: false, reason: "WRONG_B" };
  if (row.expiresAt.getTime() <= Date.now()) {
    await invalidateLinkAttempt(challengeId);
    return { ok: false, reason: "EXPIRED" };
  }
  if (payload.purpose === "PROVIDER_CREDENTIAL_LINK") {
    return { ok: true, purpose: payload.purpose, phone: payload.phone, ownerAuthUserId: payload.ownerAuthUserId, otpHash: payload.otpHash };
  }
  return { ok: true, purpose: payload.purpose, phone: payload.phone };
}

export type ProviderProofResult = { ok: true } | { ok: false; reason: "TOO_MANY_ATTEMPTS" | "INVALID_OTP" | "ALREADY_CONSUMED" };

/**
 * Verify the provider-link OTP against a loaded challenge and, on success, ATOMICALLY consume
 * the challenge (single-use). A wrong code costs one bounded attempt; exhausting attempts
 * invalidates the challenge. On a correct code the challenge is deleted and only the single
 * winner of a concurrent race gets `count === 1` — so two simultaneous correct submissions
 * authorize the mutation at most once. Never creates/updates any user/session/account.
 */
export async function verifyAndConsumeProviderProof(input: {
  challengeId: string;
  code: string;
  otpHash: string;
}): Promise<ProviderProofResult> {
  const { challengeId, code, otpHash } = input;
  if (typeof code !== "string" || code.trim() === "") return { ok: false, reason: "INVALID_OTP" };

  const { maxAttempts, expiresInSeconds } = getOtpConfig();
  // Bounded, atomic per-challenge attempt counter (independent of the OTP hash so a race on a
  // wrong code cannot grant extra tries). Exhaustion burns the challenge.
  const attempt = await consumeRateLimit(attemptKey(challengeId), maxAttempts, expiresInSeconds);
  if (!attempt.allowed) {
    await invalidateLinkAttempt(challengeId);
    return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  }

  if (!timingSafeEqualHex(hashOtp(challengeId, code), otpHash)) return { ok: false, reason: "INVALID_OTP" };

  // Atomic single-use consume — the DB row is the concurrency authority.
  const consumed = await prisma.verification.deleteMany({ where: { id: challengeId, identifier: identifierFor(challengeId) } });
  if (consumed.count === 0) return { ok: false, reason: "ALREADY_CONSUMED" };
  return { ok: true };
}

/** Consume a customer-convergence attempt (post-success cleanup; idempotent). */
export async function consumeCustomerLinkAttempt(challengeId: string): Promise<void> {
  await invalidateLinkAttempt(challengeId);
}
