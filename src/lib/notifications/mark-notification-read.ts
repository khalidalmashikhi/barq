"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Mark one notification read — Phase D.1.
//
// OWNERSHIP, VERIFIED SERVER-SIDE: the updateMany's WHERE clause
// scopes by BOTH id AND userId together — a notification id that
// exists but belongs to someone else matches zero rows and silently
// no-ops, the same uniform-response security posture
// get-booking-detail.ts/get-provider-service-detail.ts already use
// (never revealing whether "not yours" or "doesn't exist" was the
// case), rather than leaking existence via a distinct error path.
//
// IDEMPOTENT: marking an already-read notification read again is a
// harmless no-op — the extra `readAt: null` guard in the WHERE clause
// just means 0 rows match on a repeat call, never an error.
//
// Called directly from a Client Component (NotificationBell), not via
// a <form action>, since it fires from an already-open dropdown rather
// than a page-level form submission — a fully supported way to invoke
// a Server Action from client code.

export type MarkNotificationReadResult = { ok: true } | { ok: false };

export async function markNotificationRead(notificationId: string): Promise<MarkNotificationReadResult> {
  if (!isValidUuid(notificationId)) {
    return { ok: false };
  }

  const { barqUser } = await requireAuth();

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: barqUser.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/notifications");
  revalidatePath("/provider/notifications");

  return { ok: true };
}
