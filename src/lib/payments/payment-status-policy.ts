import "server-only";
import type { PaymentStatus } from "@prisma/client";

// Payment capture eligibility policy — Phase 2.16 (Payment Capture
// Foundation), relocated in Phase 2.16A (Payment Capture Domain
// Refactor).
//
// LOCATION: this pure business-rule predicate lives in the Payment
// domain folder (src/lib/payments/), not src/lib/admin/, mirroring
// src/lib/booking/cancellation-policy.ts's own placement exactly — that
// module holds canCancelBooking/canAcceptBooking/canRejectBooking/
// canStartBooking/canCompleteBooking, each consumed by exactly one
// caller (a single booking action), yet all still live in the Booking
// domain folder rather than scattered into their one respective caller.
// The rule is: state-transition eligibility for an entity belongs in
// that entity's own domain module, independent of how many call sites
// use it — src/lib/admin/cancel-booking.ts itself imports
// canCancelBooking from @/lib/booking/cancellation-policy rather than
// duplicating it, which is the same shape this file now follows for
// Payment.
//
// Mirrors cancellation-policy.ts's single-predicate simplicity, not its
// canTransition()-delegation shape: Payment has no generic lifecycle
// engine (unlike Booking's src/lib/booking/lifecycle/) and this phase
// must not build one just to express one true transition.
// DOMAIN_MODEL.md's Payment lifecycle ("Initiated -> Captured -> ...")
// makes INITIATED the only status Capture is ever reachable from — a
// Payment already CAPTURED, FAILED, or REFUNDED_* is never capturable
// again, matching this phase's own "prevent duplicate captures"
// requirement.

export function canCapturePayment(status: PaymentStatus): boolean {
  return status === "INITIATED";
}

// canRefundPayment() — Phase 2.28 (Refund Orchestration). Same
// single-predicate shape as canCapturePayment() above, deliberately
// introduced only now (not alongside Phase 2.27's gateway-only Refund
// Foundation) — mirroring exactly how canCapturePayment() itself
// arrived with Phase 2.16's orchestration action, not Phase 2.15's
// gateway-only foundation. DOMAIN_MODEL.md's Payment lifecycle
// ("Initiated -> Captured -> ...") continues into Refunded territory
// only from CAPTURED — an INITIATED Payment was never actually charged,
// and a Payment already REFUNDED_PARTIAL/REFUNDED_FULL/FAILED is not
// handled by this phase (no partial-refund-already-happened business
// logic is introduced here; see refund-payment.ts's own comment for why
// that stays out of scope until a real gateway refund exists to make it
// meaningful).
export function canRefundPayment(status: PaymentStatus): boolean {
  return status === "CAPTURED";
}
