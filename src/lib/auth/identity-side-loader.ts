import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { IdentitySide } from "./identity-convergence-policy";

// Shared, server-only readers for the identity-convergence + provider-credential-link
// engines. NOT a "use server" module (these are internal helpers, never client-callable
// server actions), so both engines can import ONE canonical loader — no second,
// inconsistent identity-loading mechanism. Pure reads; no mutation.

export type DbClient = typeof prisma | Prisma.TransactionClient;

/** The domain User id that owns `phone` (via the AuthUser credential, else a legacy User row). */
export async function findPhoneOwnerUserId(db: DbClient, phone: string): Promise<string | null> {
  const authOwner = await db.authUser.findUnique({
    where: { phoneNumber: phone },
    select: { barqUser: { select: { id: true } } },
  });
  if (authOwner?.barqUser) return authOwner.barqUser.id;
  const userOwner = await db.user.findUnique({ where: { phoneNumber: phone }, select: { id: true } });
  return userOwner?.id ?? null;
}

/** Load one identity side (User + AuthUser + eligibility signals), or null if incomplete. */
export async function loadIdentitySide(db: DbClient, userId: string): Promise<IdentitySide | null> {
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
