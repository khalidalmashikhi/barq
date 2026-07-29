import { prisma } from "@/lib/db";
import type { User } from "@prisma/client";

// BARQ User resolution — Engineering Sprint (RBAC).
//
// *** THIS FILE DID NOT EXIST BEFORE THIS SPRINT AND WAS A REAL GAP ***
// ADR-0009 added the User.authUserId link field, but no code ever
// populated it — Better Auth only creates AuthUser records (it has zero
// knowledge of BARQ's own domain). Without this bridge, RBAC has nothing
// to check, since every requireCustomer/Provider/Staff/Admin helper
// needs a BARQ User to inspect. This is not a new architectural
// decision — it directly implements DOMAIN_MODEL.md's already-stated
// User lifecycle ("Created (via OTP verification...)") and resolves
// ADR-0009's own Open Questions #1-#2 (reconciliation order,
// phone-number collision) with the simplest safe answer available.
//
// DESIGN CHOICE, FLAGGED: resolution happens lazily, on first
// authenticated request that needs it, rather than at the moment of
// Better Auth's own sign-up-on-verification. Better Auth's server
// config has no lifecycle hook configured for this (a cleaner design
// might use one, if Better Auth's `databaseHooks` API supports it —
// not implemented here since its exact shape is unverified, consistent
// with this project's standing rule not to guess at unconfirmed library
// APIs). Lazy resolution is safe and idempotent regardless of exactly
// when it runs.
//
// RECONCILIATION LOGIC (ADR-0009 Open Question #2):
// 1. If this AuthUser is already linked to a BARQ User, return it.
// 2. Otherwise, check whether a BARQ User already exists with the same
//    phone number (e.g. created earlier via Staff-Assisted Booking,
//    per DOMAIN_MODEL.md) but no AuthUser link yet — if so, link it
//    rather than creating a duplicate identity for the same phone
//    number. This is the direct, minimal resolution of that open
//    question, not a full answer to DOMAIN_MODEL.md's separate,
//    still-open Question #1 (whether one User may hold multiple roles).
// 3. Otherwise, create a new, bare BARQ User plus its Customer profile,
//    atomically in one transaction (Phase 5.1 — Production Readiness:
//    self-service signup). Customer has no required fields beyond
//    userId, so every genuinely new phone number is a real Customer
//    the moment it exists — closing the launch-blocking gap where a
//    real signup could authenticate but never book (requireCustomer()
//    would throw ForbiddenError forever with no self-service path to
//    resolve it). Provider remains a deliberate, separate upgrade via
//    the new self-service application flow (see apply-as-provider.ts),
//    not something granted automatically here.

export async function resolveBarqUser(authUserId: string): Promise<User> {
  const existingLink = await prisma.user.findUnique({
    where: { authUserId },
  });

  if (existingLink) {
    return existingLink;
  }

  const authUser = await prisma.authUser.findUniqueOrThrow({
    where: { id: authUserId },
  });

  if (!authUser.phoneNumber) {
    // Should not occur for BARQ's phone-only flow — flagged rather than
    // silently handled, since it indicates an AuthUser was created
    // through some path this reconciliation logic doesn't expect.
    throw new Error(
      `resolveBarqUser: AuthUser ${authUserId} has no phoneNumber; cannot reconcile to a BARQ User.`
    );
  }

  // Captured as its own const so the null-check above stays proven true
  // inside the $transaction callback below — TypeScript's narrowing of
  // authUser.phoneNumber does not persist across that function boundary.
  const phoneNumber = authUser.phoneNumber;

  const unlinkedExistingUser = await prisma.user.findFirst({
    where: {
      phoneNumber: authUser.phoneNumber,
      authUserId: null,
    },
  });

  if (unlinkedExistingUser) {
    return prisma.user.update({
      where: { id: unlinkedExistingUser.id },
      data: { authUserId },
    });
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phoneNumber,
        phoneNumberVerified: authUser.phoneNumberVerified,
        authUserId,
      },
    });

    await tx.customer.create({ data: { userId: user.id } });

    return user;
  });
}
