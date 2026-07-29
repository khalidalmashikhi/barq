"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Mark all notifications read — Phase D.1.
//
// OWNERSHIP: scoped to the authenticated user's own userId, resolved
// server-side via requireAuth().
//
// PERFORMANCE: a single updateMany, not N individual UPDATE
// statements — avoids an N+1 write regardless of how many unread
// notifications a user has accumulated.

export type MarkAllNotificationsReadResult = { ok: true };

export async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResult> {
  const { barqUser } = await requireAuth();

  await prisma.notification.updateMany({
    where: { userId: barqUser.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
  revalidatePath("/provider/notifications");

  return { ok: true };
}
