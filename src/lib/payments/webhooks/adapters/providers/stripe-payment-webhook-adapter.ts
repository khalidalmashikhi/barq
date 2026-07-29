import "server-only";
import type Stripe from "stripe";
import { isPaymentWebhookEvent } from "../../payment-webhook-event";
import type { PaymentWebhookAdapter, PaymentWebhookAdapterResult } from "../payment-webhook-adapter";

// Stripe Webhook Adapter — Phase 2.22 (First Payment Provider).
// Translation only, per this phase's own "No business logic" scope —
// mirrors generic-payment-webhook-adapter.ts's (Phase 2.18) exact
// shape: validate the incoming payload's real shape, reshape it into
// PaymentWebhookEvent, re-validate via the same shared
// isPaymentWebhookEvent() guard, return INVALID_PAYLOAD for anything it
// cannot honestly translate.
//
// EVENT TYPE MAPPING: only the two outcomes capture-payment.ts/
// processPaymentWebhookEvent() already model are translated —
// 'payment_intent.succeeded' -> CAPTURED, 'payment_intent.payment_failed'
// -> FAILED. Every other Stripe event type (Stripe sends many —
// charge.refunded, customer.created, etc.) is reported as
// INVALID_PAYLOAD: there is no PaymentStatus value this adapter could
// honestly assign to them, the same reasoning
// process-payment-webhook-event.ts already applies to reject
// REFUNDED_PARTIAL/REFUNDED_FULL/INITIATED (Phase 2.17) — Refund
// remains out of scope, so a refund-related Stripe event genuinely
// cannot be translated here today.
//
// BOOKING LINKAGE: reads `data.object.metadata.bookingId`, the exact
// field stripe-payment-gateway-provider.ts's own initiate() sets when
// creating the PaymentIntent (this same phase) — the only place Stripe
// lets this codebase attach its own bookingId to a PaymentIntent.
//
// providerEventId is the Stripe Event's own `id` (already surfaced by
// the Verifier too — see payment-webhook-event.ts's own "replay
// preparation, not protection" comment for why this field exists and
// why nothing yet acts on it); occurredAt is Stripe's own `created`
// timestamp (Unix seconds, converted to milliseconds).

const SUPPORTED_EVENT_TYPES: Record<string, "CAPTURED" | "FAILED"> = {
  "payment_intent.succeeded": "CAPTURED",
  "payment_intent.payment_failed": "FAILED",
};

export const stripePaymentWebhookAdapter: PaymentWebhookAdapter = {
  key: "STRIPE",

  translate(payload: unknown): PaymentWebhookAdapterResult {
    if (typeof payload !== "object" || payload === null || !("type" in payload) || !("data" in payload)) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    const stripeEvent = payload as Stripe.Event;
    const status = SUPPORTED_EVENT_TYPES[stripeEvent.type];

    if (!status) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    const paymentIntent = stripeEvent.data.object as { id?: unknown; metadata?: Record<string, unknown> };
    const bookingId = paymentIntent.metadata?.bookingId;

    if (typeof bookingId !== "string") {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    const event = {
      providerKey: "STRIPE",
      providerEventId: stripeEvent.id,
      bookingId,
      status,
      occurredAt: new Date(stripeEvent.created * 1000),
    };

    if (!isPaymentWebhookEvent(event)) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    return { ok: true, event };
  },
};
