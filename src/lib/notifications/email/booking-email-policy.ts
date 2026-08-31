import type { BookingNotificationKind } from "@/lib/booking/lifecycle/notify";

// BOOKING NOTIFICATION DELIVERY — the email delivery POLICY: which booking-notification kinds are
// sent as transactional email, and (for link/framing) whether each is addressed to the customer or
// the provider. Pure data + pure predicates, isomorphic (no I/O), so both the enqueue seam and the
// content renderer read the SAME policy.
//
// Deliberately NOT email-eligible (in-app only), per the approved policy:
//   PROVIDER_BOOKING_CONFIRMED / PROVIDER_BOOKING_REJECTED — a provider's OWN-action self-receipt
//     (they just clicked accept/reject); emailing it back is noise.
//   NEW_REVIEW_RECEIVED — deferred (in-app only this gate).
//   BOOKING_EXPIRED to the PROVIDER — the customer is emailed; the provider keeps the in-app
//     notice only (avoid operational noise; no concrete provider-email need was found).
// IN_PROGRESS / COMPLETED / REVIEW_REQUESTED have no producer here and stay frozen for the next gate.

/// Who the email is addressed to — determines the canonical link route (customer vs provider
/// booking detail) and the framing of the copy. NOT a recipient lookup (the recipient User.id is
/// passed explicitly by the caller); purely the audience of THIS kind.
export type BookingEmailAudience = "CUSTOMER" | "PROVIDER";

/// The kinds that produce a transactional email, mapped to their audience. A kind absent from this
/// map is in-app only. BOOKING_EXPIRED is addressed to the CUSTOMER (the only expiry email
/// recipient); the provider's expiry stays in-app, so the hook simply never enqueues an email for
/// the provider side of expiry.
const EMAIL_ELIGIBLE: Partial<Record<BookingNotificationKind, BookingEmailAudience>> = {
  PENDING_PROVIDER: "PROVIDER",
  BOOKING_ACCEPTED: "CUSTOMER",
  BOOKING_REJECTED: "CUSTOMER",
  BOOKING_CANCELLED: "CUSTOMER",
  BOOKING_CANCELLED_BY_CUSTOMER: "PROVIDER",
  BOOKING_EXPIRED: "CUSTOMER",
  // COMPLETION & REVIEW LOOP — the customer's service-started and service-completed emails. The
  // completion email carries the review invitation/CTA (no separate REVIEW_REQUESTED email).
  BOOKING_STARTED: "CUSTOMER",
  BOOKING_COMPLETED: "CUSTOMER",
};

/** Is this booking-notification kind sent as a transactional email at all? */
export function isEmailEligibleKind(kind: BookingNotificationKind): boolean {
  return kind in EMAIL_ELIGIBLE;
}

/** The audience (customer/provider) for an email-eligible kind, or null if the kind is in-app only. */
export function bookingEmailAudience(kind: BookingNotificationKind): BookingEmailAudience | null {
  return EMAIL_ELIGIBLE[kind] ?? null;
}

/** The full set of email-eligible kinds — exported for tests / exhaustiveness checks. */
export const EMAIL_ELIGIBLE_KINDS = Object.keys(EMAIL_ELIGIBLE) as BookingNotificationKind[];
