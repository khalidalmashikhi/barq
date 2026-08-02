import "server-only";
import { prisma } from "@/lib/db";

// Last-login derivation — User & Access Management (Batch 6). Derived, never
// stored (no schema field added). A BARQ User links to a Better Auth AuthUser
// (User.authUserId), and Session rows reference AuthUser.id. The most recent
// Session.createdAt is the best available "last login" signal in the existing
// data model. Returns null when the user has no auth link or no sessions — the
// caller renders a localized "Never". Read-only; does not touch Better Auth.

export async function getLastLoginAt(authUserId: string | null): Promise<Date | null> {
  if (!authUserId) return null;
  const session = await prisma.session.findFirst({
    where: { userId: authUserId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return session?.createdAt ?? null;
}
