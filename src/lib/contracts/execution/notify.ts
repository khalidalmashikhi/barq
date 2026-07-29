import "server-only";
import { prisma } from "@/lib/db";
import { BookingNotFoundError } from "@/lib/booking/lifecycle";

// Notification Hooks — Phase E.3, requirement #7: "Reuse the existing
// notification architecture." There is no existing "create
// notification" service function anywhere in the codebase to call
// (src/lib/notifications/ is read-only: get-notifications,
// get-unread-count, mark-*-read — every Notification row today comes
// only from the seed script) — so "reuse the architecture" means reuse
// the Notification MODEL's own shape (bilingual `content` Json,
// `channel`, `causingBookingId`) exactly as Phase D.1 defined it,
// written directly here, rather than inventing a parallel
// notification concept. This file does not modify
// src/lib/notifications/ at all.

export type ContractNotificationKind = "CONTRACT_READY" | "SIGN_REMINDER" | "EXECUTED" | "EXPIRED";

const MESSAGES: Record<ContractNotificationKind, { ar: string; en: string }> = {
  CONTRACT_READY: { ar: "عقدك جاهز للمراجعة والتوقيع.", en: "Your contract is ready to review and sign." },
  SIGN_REMINDER: { ar: "تذكير: يوجد عقد بانتظار توقيعك.", en: "Reminder: a contract is waiting for your signature." },
  EXECUTED: { ar: "تم توقيع العقد بالكامل وأصبح ساري المفعول.", en: "The contract has been fully signed and is now active." },
  EXPIRED: { ar: "انتهت مهلة توقيع العقد.", en: "The contract's signing window has expired." },
};

export interface NotifyContractEventParams {
  userId: string;
  bookingId: string;
  kind: ContractNotificationKind;
}

export async function notifyContractEvent(params: NotifyContractEventParams): Promise<void> {
  const { userId, bookingId, kind } = params;

  await prisma.notification.create({
    data: {
      userId,
      content: MESSAGES[kind],
      channel: "EMAIL",
      causingBookingId: bookingId,
    },
  });
}

export interface ContractParties {
  customerUserId: string;
  providerUserId: string;
}

// Booking.customerId/providerId are Customer.id/Provider.id, not
// User.id — Notification.userId needs the actual User — so this is
// the one extra join every notify call site needs. Kept here (not
// duplicated at each hook) since every notification this phase sends
// needs it.
export async function resolveContractParties(bookingId: string): Promise<ContractParties> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customer: { select: { userId: true } }, provider: { select: { userId: true } } },
  });

  if (!booking) {
    throw new BookingNotFoundError(bookingId);
  }

  return { customerUserId: booking.customer.userId, providerUserId: booking.provider.userId };
}
