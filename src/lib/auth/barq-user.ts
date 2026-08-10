import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";

// BARQ User resolution — the Better Auth ⇄ BARQ identity bridge.
//
// GATE 2 (Social Login — identity foundation) rewrite. The bridge is now a
// small, deterministic, race-safe state machine that supports BOTH the existing
// phone+OTP identity AND a phone-less Google/Apple-first identity, WITHOUT ever
// silently merging two existing BARQ identities.
//
// CORE INVARIANTS (approved policy):
//   • One `AuthUser` maps to at most one BARQ `User`. `authUserId` (@unique on
//     User) is the primary internal bridge — the FIRST thing checked.
//   • A VERIFIED phone is a reconciliation identifier, never permission to merge
//     two already-existing identities. `authUser.phoneNumberVerified` is
//     REQUIRED before a phone may claim/link anything (§5 trust rule).
//   • Email, name, Google/Apple profile, relay email, and image are NEVER
//     identity authority and are never read here.
//   • No Provider/Admin/Customer/booking/document/audit relation is ever moved,
//     duplicated, or deleted by this bridge.
//
// CONCURRENCY: every write is guarded by a DB uniqueness constraint
// (`users.authUserId` unique, `users.phoneNumber` unique) plus an atomic
// conditional operation, so two simultaneous resolves can never produce two
// BARQ Users for one AuthUser. Lost races are resolved by catching the unique
// violation (P2002) and re-reading the winner. No new schema/index is required
// for this — the existing constraints are sufficient.
//
// resolveBarqUser() ALWAYS returns a User (or throws only on a genuine,
// unexpected error). It never throws for a phone conflict — that would lock a
// social user out of every page. Verified-phone COMPLETION for an already-linked
// phone-less user (and the hard phone-conflict outcome) is a separate, explicit
// operation: reconcileVerifiedPhone(), which the Gate-5 "verify your phone" flow
// will call and whose typed conflict the UI will surface. resolveBarqUser() does
// NOT implicitly attempt it (kept as a pure per-request bridge).

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Resolve the BARQ `User` for a Better Auth `AuthUser` id, creating/linking as
 * needed. Deterministic state machine:
 *
 *   A. AuthUser already linked → return that User (no writes, no overwrite).
 *   B. Verified phone matches an existing UNLINKED legacy User → atomically
 *      claim/link it (preserves Customer/Provider/Admin/Staff/bookings/etc.).
 *   C. No verified phone, nobody to link → create a phone-less User + Customer.
 *   D. Verified phone owned by nobody → create a User (with phone) + Customer.
 */
export async function resolveBarqUser(authUserId: string): Promise<User> {
  // Case A — already linked (authUserId is the primary bridge key).
  const linked = await prisma.user.findUnique({ where: { authUserId } });
  if (linked) return linked;

  const authUser = await prisma.authUser.findUniqueOrThrow({ where: { id: authUserId } });

  // §5 TRUST RULE: a phone is a reconciliation identifier ONLY when Better Auth
  // has marked it verified. An unverified phone must never claim an existing
  // identity, so it is treated as "no phone" here.
  const verifiedPhone = authUser.phoneNumberVerified && authUser.phoneNumber ? authUser.phoneNumber : null;

  // Case B — legacy unlinked BARQ User with the same VERIFIED phone → claim it.
  if (verifiedPhone) {
    const claimed = await claimUnlinkedUserByPhone(verifiedPhone, authUserId);
    if (claimed) return claimed;
  }

  // Case C (verifiedPhone === null) / Case D (verifiedPhone owned by nobody).
  return createBarqUserForAuthUser(authUserId, verifiedPhone);
}

/**
 * Atomically link an UNLINKED legacy User that already holds `phone` to this
 * AuthUser. Race-safe: the `authUserId: null` guard means only one concurrent
 * caller can win; a loser sees count 0 and returns null (falling through to the
 * create path, which then resolves via the authUserId-unique backstop). Returns
 * null when no unlinked User holds this phone.
 */
async function claimUnlinkedUserByPhone(phone: string, authUserId: string): Promise<User | null> {
  const result = await prisma.user.updateMany({
    where: { phoneNumber: phone, authUserId: null },
    data: { authUserId },
  });
  if (result.count === 0) return null;
  // Exactly the row we just linked; fetch it by the now-set unique authUserId.
  return prisma.user.findUnique({ where: { authUserId } });
}

/**
 * Create a fresh BARQ User (+ Customer) for this AuthUser, atomically. If a
 * concurrent resolve for the SAME authUserId won (users.authUserId unique) — or,
 * defensively, the verified phone was claimed concurrently (users.phoneNumber
 * unique) — the unique violation is caught and the already-linked winner is
 * returned, so there is never a second BARQ User for one AuthUser.
 */
async function createBarqUserForAuthUser(authUserId: string, verifiedPhone: string | null): Promise<User> {
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phoneNumber: verifiedPhone, // null for a social-first user (Case C)
          phoneNumberVerified: verifiedPhone !== null,
          authUserId,
        },
      });
      await tx.customer.create({ data: { userId: user.id } });
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.user.findUnique({ where: { authUserId } });
      if (existing) return existing;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Verified-phone completion + hard phone conflict (explicit; Gate-5 flow).
// ---------------------------------------------------------------------------

export type PhoneReconcileResult =
  | { ok: true; user: User }
  | {
      ok: false;
      error: "NO_VERIFIED_PHONE" | "NO_BARQ_USER" | "PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT";
    };

/**
 * Attach the AuthUser's VERIFIED phone to its already-linked, currently
 * phone-less BARQ User (the "complete your phone after social signup" step).
 *
 *   • Unused phone → atomically set it on the SAME BARQ User (no new
 *     User/Customer, Provider/Admin untouched). Idempotent.
 *   • Phone owned by ANOTHER BARQ User → HARD CONFLICT
 *     `PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT`: nothing is merged, moved,
 *     deleted, or overwritten. The UI (Gate 5) tells the person to sign in to
 *     the existing account and connect the social provider from Settings.
 *
 * Email/name equality is NEVER used as justification. The phone must be verified
 * (§5). The DB `users.phoneNumber` unique constraint is the race-safe authority.
 */
export async function reconcileVerifiedPhone(authUserId: string): Promise<PhoneReconcileResult> {
  const authUser = await prisma.authUser.findUniqueOrThrow({ where: { id: authUserId } });
  if (!authUser.phoneNumber || !authUser.phoneNumberVerified) {
    return { ok: false, error: "NO_VERIFIED_PHONE" };
  }
  const phone = authUser.phoneNumber;

  const user = await prisma.user.findUnique({ where: { authUserId } });
  if (!user) return { ok: false, error: "NO_BARQ_USER" };

  // Idempotent: the phone is already on this exact user.
  if (user.phoneNumber === phone) return { ok: true, user };

  // The linked user must currently be phone-less to receive a phone. If it
  // somehow already holds a DIFFERENT phone, refuse rather than overwrite.
  if (user.phoneNumber !== null) {
    return { ok: false, error: "PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT" };
  }

  // Fast, clear conflict signal for the common (non-racy) case: another BARQ
  // User already owns this phone.
  const owner = await prisma.user.findUnique({ where: { phoneNumber: phone } });
  if (owner && owner.id !== user.id) {
    return { ok: false, error: "PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT" };
  }

  // Atomic conditional claim (guards the check→write race; the unique index is
  // the ultimate authority if two claims race for the same phone).
  try {
    const result = await prisma.user.updateMany({
      where: { id: user.id, phoneNumber: null },
      data: { phoneNumber: phone, phoneNumberVerified: true },
    });
    if (result.count === 0) {
      const reread = await prisma.user.findUnique({ where: { id: user.id } });
      if (reread && reread.phoneNumber === phone) return { ok: true, user: reread };
      return { ok: false, error: "PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT" };
    }
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { ok: true, user: updated };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent claimer took this phone for another User first.
      return { ok: false, error: "PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT" };
    }
    throw error;
  }
}
