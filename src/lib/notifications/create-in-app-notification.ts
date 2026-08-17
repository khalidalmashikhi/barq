import "server-only";
import { prisma } from "@/lib/db";

// Gate B2 — the ONE low-level writer for actionable in-app notifications. Every
// new provider/admin notification goes through here (or notifyActiveAdmins below)
// rather than a scattered prisma.notification.create, so the invariants live in a
// single place:
//   - channel is ALWAYS IN_APP (the Notification Center record; no external
//     email/SMS is dispatched — no delivery pipeline exists).
//   - eventType is a stable machine key; entityType/entityId are structured,
//     server-derived metadata. A raw href / signed URL / objectKey is NEVER
//     stored — the CTA route is resolved from (eventType, entityType, entityId)
//     by the B3 UI, not persisted here.
//   - content is the bilingual/multilingual locale map (same shape the legacy
//     writers used), optionally carrying `kind` for the existing presentation
//     layer until B3 rebuilds rendering off eventType.
// Recipients are ALWAYS resolved by server-side domain code (never client input);
// this writer only persists what it is given. Notifications are UX — they NEVER
// replace the AuditLog, which remains the security/operational history.

export type InAppNotificationContent = Record<string, unknown>;

export type CreateInAppNotificationInput = {
  /// The recipient's User id (Notification.userId), resolved server-side.
  recipientUserId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  content: InAppNotificationContent;
};

export async function createInAppNotification(input: CreateInAppNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.recipientUserId,
      channel: "IN_APP",
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      content: input.content as object,
    },
  });
}

export type NotifyActiveAdminsInput = {
  eventType: string;
  entityType: string;
  entityId: string;
  content: InAppNotificationContent;
};

// Admin fan-out — ONE IN_APP notification row per ACTIVE Admin (per-admin rows,
// not a shared global inbox, so each admin keeps independent read/unread + unread
// count, and it scales to multiple admins). Recipients are derived here from
// Admin.userId server-side; an admin user id is NEVER accepted from the caller.
// DEACTIVATED admins are ignored (WHERE status = ACTIVE); zero active admins is a
// safe no-op.
export async function notifyActiveAdmins(input: NotifyActiveAdminsInput): Promise<void> {
  const admins = await prisma.admin.findMany({
    where: { status: "ACTIVE" },
    select: { userId: true },
  });
  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.userId,
      channel: "IN_APP" as const,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      content: input.content as object,
    })),
  });
}
