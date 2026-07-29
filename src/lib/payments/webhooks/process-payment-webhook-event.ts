import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { canCapturePayment } from "@/lib/payments/payment-status-policy";
import { logger } from "@/lib/logger";
import { isPaymentWebhookEvent } from "./payment-webhook-event";

// Provider-independent Payment Webhook processing entry point — Phase
// 2.17 (Payment Webhook Foundation). The one place any future provider
// adapter's already-translated PaymentWebhookEvent is handed to Payment
// domain logic. This function itself never knows Stripe/PayPal/OmanNet
// exist — it only ever sees the canonical event shape — matching
// payment-gateway-provider.ts's own "no provider-specific logic outside
// the provider layer" discipline, applied to the inbound direction. It
// also serves as this phase's "webhook dispatcher": with exactly one
// real event category to route today (a capture outcome), a separate
// dispatch layer on top of this function would be an abstraction with
// nothing yet to abstract over — deferred until a second, genuinely
// distinct event category (e.g. a future Refund event) actually exists
// to route between.
//
// SCOPE: only CAPTURED and FAILED are handled today — the same two
// outcomes capture-payment.ts (Phase 2.16) already models via
// gatewayResult.status. REFUNDED_PARTIAL/REFUNDED_FULL are explicitly
// rejected with UNSUPPORTED_STATUS rather than silently processed —
// Refund remains out of scope per Phase 2.14's own conclusion (it
// cannot be built honestly without a real gateway). INITIATED is
// rejected too: no provider ever reports "still initiated" as a
// notification — that status already exists at Payment creation,
// before any webhook could fire.
//
// IDEMPOTENCY: a Payment that is no longer capturable (i.e.
// !canCapturePayment(payment.status) — already CAPTURED, FAILED, or
// REFUNDED_*) returns ALREADY_PROCESSED rather than throwing or
// silently re-writing. This matters even before any real provider
// exists: API_CONTRACTS.md §12 already commits to "every webhook
// delivery carries an identifier allowing the receiver to safely handle
// duplicate delivery" — a redelivered event for an already-settled
// Payment must be a safe no-op, not an error.
//
// SHARED ELIGIBILITY RULE, SEPARATE ORCHESTRATION: this function reuses
// canCapturePayment() (the same predicate capture-payment.ts uses) but
// does not call into or share a transaction with capture-payment.ts
// itself — each entry point independently owns its own orchestration,
// exactly like src/lib/booking/cancel-booking.ts and
// src/lib/admin/cancel-booking.ts each independently implement their
// own transaction around the one shared canCancelBooking() predicate.
//
// AUDIT: recordAuditEvent() with actorType "SYSTEM", actorId null —
// exactly expire-stale-bookings.ts's own precedent for a
// system-triggered (not human-triggered) mutation; not a new, second
// audit mechanism.
//
// TRANSACTION BOUNDARY: unlike capture-payment.ts, no gateway call
// happens here at all — this function only persists an event a
// provider already reported, so there is no network I/O that must stay
// outside prisma.$transaction. The entire lookup-check-write-audit
// sequence is safe inside one transaction.

export type ProcessPaymentWebhookEventResult =
  | { ok: true; applied: true }
  | { ok: true; applied: false; reason: "ALREADY_PROCESSED" }
  | { ok: false; error: "INVALID_EVENT" | "PAYMENT_NOT_FOUND" | "UNSUPPORTED_STATUS" };

const SUPPORTED_STATUSES = ["CAPTURED", "FAILED"] as const;

export async function processPaymentWebhookEvent(event: unknown): Promise<ProcessPaymentWebhookEventResult> {
  if (!isPaymentWebhookEvent(event)) {
    return { ok: false, error: "INVALID_EVENT" };
  }

  if (!(SUPPORTED_STATUSES as readonly string[]).includes(event.status)) {
    logger.warn("processPaymentWebhookEvent.unsupported_status", {
      providerKey: event.providerKey,
      providerEventId: event.providerEventId,
      status: event.status,
    });
    return { ok: false, error: "UNSUPPORTED_STATUS" };
  }

  const payment = await prisma.payment.findUnique({ where: { bookingId: event.bookingId } });

  if (!payment) {
    return { ok: false, error: "PAYMENT_NOT_FOUND" };
  }

  if (!canCapturePayment(payment.status)) {
    return { ok: true, applied: false, reason: "ALREADY_PROCESSED" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: event.status,
        capturedAt: event.status === "CAPTURED" ? event.occurredAt : null,
      },
    });

    await recordAuditEvent(
      {
        actorType: "SYSTEM",
        actorId: null,
        action: "payment.webhook_processed",
        entityType: "Payment",
        entityId: payment.id,
        previousValue: { status: payment.status },
        newValue: { status: event.status, providerKey: event.providerKey, providerEventId: event.providerEventId },
      },
      tx
    );
  });

  return { ok: true, applied: true };
}
