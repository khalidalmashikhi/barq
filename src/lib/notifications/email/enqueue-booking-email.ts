import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { BookingNotificationKind } from "@/lib/booking/lifecycle/notify";
import { isEmailEligibleKind } from "./booking-email-policy";

// BOOKING NOTIFICATION DELIVERY — POST-COMMIT durable enqueue of one outbox row. Called from the
// lifecycle hooks right after the in-app Notification is written (the booking transaction has
// already committed). BEST-EFFORT AND FULLY GUARDED (§6/§7): any failure here is swallowed + logged
// and NEVER propagated, so it can never fail or roll back the already-committed booking action.
//
// DURABILITY BOUNDARY (honest): this is NOT a true transactional outbox — the row is inserted after
// commit, not atomically with the booking mutation (the authoritative booking transactions are
// deliberately not rewritten). A crash in the narrow commit→enqueue window loses this email, the
// SAME at-least-once boundary the existing in-app notifications already have. Once enqueued, the row
// is durable and the delivery worker guarantees bounded at-least-once external delivery.
//
// IDEMPOTENCY: the row is created against the @@unique(bookingId, kind, recipientUserId) constraint;
// a duplicate (a booking-create replay, a re-fired hook) hits P2002 and is treated as a no-op — no
// second email. Non-eligible kinds are ignored (in-app only).

export async function enqueueBookingEmail(params: {
  bookingId: string;
  recipientUserId: string;
  kind: BookingNotificationKind;
}): Promise<void> {
  const { bookingId, recipientUserId, kind } = params;
  if (!isEmailEligibleKind(kind)) return;

  try {
    await prisma.bookingEmailDelivery.create({
      data: { bookingId, recipientUserId, kind, status: "PENDING" },
    });
  } catch (error) {
    // P2002 (unique violation) = this (booking, kind, recipient) email is already enqueued → the
    // intended, idempotent no-op, not an error worth surfacing.
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return;
    }
    // Any other failure (e.g. DB blip): the booking already succeeded; we only lose this one email's
    // durability. Log safely (ids only, no PII) and swallow — never rethrow into the booking action.
    logger.warn("bookingEmail.enqueue_failed", {
      bookingId,
      recipientUserId,
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
