import "server-only";
import { prisma } from "@/lib/db";
import { BookingNotFoundError } from "./errors";

// Booking Lifecycle Notifications — Phase 4.1 ("Complete the Booking
// Lifecycle"), requirement #3: "Reuse the existing notification
// infrastructure." Structurally identical to
// src/lib/contracts/execution/notify.ts (same bilingual-literal-map
// pattern, same `channel: "EMAIL"` convention) — not introducing a new
// notification shape, just matching the one this codebase already
// established. No real email dispatch exists anywhere yet; this only
// writes the in-app Notification row that the existing Notification
// Center (list/unread-count/mark-read) already renders.

export type BookingNotificationKind =
  | "PENDING_PROVIDER"
  | "BOOKING_ACCEPTED"
  | "BOOKING_REJECTED"
  | "BOOKING_CANCELLED"
  | "BOOKING_CANCELLED_BY_CUSTOMER"
  | "BOOKING_EXPIRED"
  | "PROVIDER_BOOKING_CONFIRMED"
  | "PROVIDER_BOOKING_REJECTED"
  | "NEW_REVIEW_RECEIVED";

const MESSAGES: Record<BookingNotificationKind, { ar: string; en: string }> = {
  PENDING_PROVIDER: { ar: "لديك طلب حجز جديد بانتظار الرد.", en: "You have a new booking request awaiting your response." },
  BOOKING_ACCEPTED: { ar: "تم قبول حجزك من قبل مزود الخدمة.", en: "Your booking has been accepted by the provider." },
  BOOKING_REJECTED: { ar: "تم رفض حجزك من قبل مزود الخدمة.", en: "Your booking has been rejected by the provider." },
  BOOKING_CANCELLED: { ar: "تم إلغاء حجزك.", en: "Your booking has been cancelled." },
  // Phase 4.2 (Provider Experience, Priority 5 — Notifications): the
  // provider's own side of a customer-initiated cancellation. Before
  // this, cancel-booking.ts (a customer-only action) notified the
  // customer their own cancellation went through, but never told the
  // provider they lost a booking — a real gap the Provider UX Review
  // flagged under "Booking reminders"/"Actions."
  BOOKING_CANCELLED_BY_CUSTOMER: { ar: "قام العميل بإلغاء أحد حجوزاتك.", en: "A customer has cancelled one of your bookings." },
  // Phase 5.1 (Production Readiness) — a system-driven timeout, not a
  // choice either party made; one shared, neutral message works for
  // both the customer and the provider (unlike BOOKING_CANCELLED /
  // BOOKING_CANCELLED_BY_CUSTOMER, which need two different framings
  // for the two different audiences).
  BOOKING_EXPIRED: {
    ar: "انتهت صلاحية طلب الحجز لأن الوقت المحدد قد مضى دون رد.",
    en: "This booking request expired because the scheduled time passed with no response.",
  },
  // Provider Notifications & Operational Alerts phase — the provider's
  // own confirmation receipt for an action they just took themselves
  // (acceptBooking()/rejectBooking() are both requireProvider()-gated).
  // Distinct from BOOKING_ACCEPTED/BOOKING_REJECTED above, which are
  // always customer-framed ("your booking was...") — these two exist
  // purely so the provider's own Notification Center reflects their own
  // recent decisions, per this phase's explicit "Booking confirmed" /
  // "Booking rejected" provider-facing alert requirement.
  PROVIDER_BOOKING_CONFIRMED: {
    ar: "لقد قمت بتأكيد طلب حجز.",
    en: "You confirmed a booking request.",
  },
  PROVIDER_BOOKING_REJECTED: {
    ar: "لقد قمت برفض طلب حجز.",
    en: "You declined a booking request.",
  },
  // Fired from create-review.ts after a review is successfully created
  // (see that file's own comment) — reuses this exact writer/shape
  // rather than a parallel review-notification mechanism.
  NEW_REVIEW_RECEIVED: {
    ar: "تلقيت تقييمًا جديدًا من أحد العملاء.",
    en: "You received a new review from a customer.",
  },
};

export interface NotifyBookingEventParams {
  userId: string;
  bookingId: string;
  kind: BookingNotificationKind;
}

// TOUR-2.5A1 — the B3 structured-action eventType for a booking-lifecycle kind,
// used ONLY to make a row actionable via the centralized allowlist resolver
// (resolve-notification-action.ts). Deliberately partial: only PENDING_PROVIDER
// (the new-booking notification) carries one today, so every OTHER kind writes
// EXACTLY as before (no eventType) — no behavior change and no new CTA for them.
// This does NOT add a second notification; it enriches the single existing one.
const EVENT_TYPE_BY_KIND: Partial<Record<BookingNotificationKind, string>> = {
  PENDING_PROVIDER: "booking.created",
};

export async function notifyBookingEvent(params: NotifyBookingEventParams): Promise<void> {
  const { userId, bookingId, kind } = params;

  const eventType = EVENT_TYPE_BY_KIND[kind];

  await prisma.notification.create({
    data: {
      userId,
      // `kind` is stored inline in this free-form Json column alongside
      // the rendered ar/en strings (no Prisma schema change — there is
      // no dedicated kind column) so the Notification Center can later
      // recover which real event produced this row for icon/badge
      // presentation, instead of guessing from causingBookingId. Rows
      // written before this phase have no `kind` key at all; readers
      // must treat it as optional and fall back safely (see
      // src/components/notifications/notification-presentation.ts).
      content: { ...MESSAGES[kind], kind },
      channel: "EMAIL",
      // Preserved for backward compatibility (existing readers / presentation).
      causingBookingId: bookingId,
      // Structured B3 metadata for the centralized CTA resolver — set ONLY for a
      // mapped kind. entityId is the booking id; the resolver re-validates it as a
      // strict UUID and NEVER reads a stored href.
      ...(eventType ? { eventType, entityType: "Booking", entityId: bookingId } : {}),
    },
  });
}

export interface BookingParties {
  customerUserId: string;
  providerUserId: string;
}

// Booking.customerId/providerId are Customer.id/Provider.id, not
// User.id — Notification.userId needs the actual User — so this is the
// one extra join every hook below needs. Kept here (not duplicated at
// each hook) since every notification this phase sends needs it.
export async function resolveBookingParties(bookingId: string): Promise<BookingParties> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customer: { select: { userId: true } }, provider: { select: { userId: true } } },
  });

  if (!booking) {
    throw new BookingNotFoundError(bookingId);
  }

  return { customerUserId: booking.customer.userId, providerUserId: booking.provider.userId };
}
