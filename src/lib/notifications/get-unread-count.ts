import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Unread notification count — Phase D.1.
//
// OWNERSHIP: scoped to the authenticated user's own userId, resolved
// server-side via requireAuth() — never trusts a client-supplied
// identity.
//
// PERFORMANCE: a single, indexed COUNT. The
// @@index([userId, readAt, createdAt]) composite index added to the
// Notification model this same phase covers this exact
// `WHERE userId = ? AND readAt IS NULL` shape, so this resolves via
// an index scan rather than a full table scan regardless of how many
// notifications a user accumulates over time.

export async function getUnreadCount(): Promise<number> {
  const { barqUser } = await requireAuth();

  return prisma.notification.count({
    where: { userId: barqUser.id, readAt: null },
  });
}
