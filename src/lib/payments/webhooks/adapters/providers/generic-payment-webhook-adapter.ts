import "server-only";
import { isPaymentWebhookEvent } from "../../payment-webhook-event";
import type { PaymentWebhookAdapter, PaymentWebhookAdapterResult } from "../payment-webhook-adapter";

// Generic Payment Webhook Adapter — Phase 2.18 (Payment Webhook Adapter
// Foundation). This phase's ONLY real, working translation path: unlike
// noOpPaymentGatewayProvider's capture()/refund() (which always throw,
// since no honest fake exists for a financial outcome), translation is
// pure data reshaping with no financial risk — there IS an honest
// default here, mirroring internal-signature-provider.ts's own
// precedent (a genuinely working, non-vendor-specific default, not a
// throw-only placeholder).
//
// WHAT IT TRANSLATES: a payload already shaped like the canonical event's
// own fields, but with realistic wire-transport types — specifically
// `occurredAt` as an ISO date string, not a Date instance, since JSON
// has no Date type. This is real translation work (string -> Date,
// unknown -> typed canonical shape), not a passthrough of an
// already-typed object. A future real vendor adapter (Stripe, PayPal,
// OmanNet) additionally remaps vendor-specific field names/enums to
// this same canonical shape — this adapter is the trivial case where
// the source field names already match.
//
// ZERO BUSINESS RULES: this function never checks whether a Payment
// exists, whether it's currently capturable, or writes anything —
// translate() either produces a valid PaymentWebhookEvent or reports
// INVALID_PAYLOAD; nothing else. All of that remains inside
// processPaymentWebhookEvent(), completely untouched by this phase.

export const genericPaymentWebhookAdapter: PaymentWebhookAdapter = {
  key: "GENERIC",

  translate(payload: unknown): PaymentWebhookAdapterResult {
    if (typeof payload !== "object" || payload === null) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    const raw = payload as Record<string, unknown>;

    if (
      typeof raw.providerKey !== "string" ||
      typeof raw.providerEventId !== "string" ||
      typeof raw.bookingId !== "string" ||
      typeof raw.status !== "string" ||
      typeof raw.occurredAt !== "string"
    ) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    const event = {
      providerKey: raw.providerKey,
      providerEventId: raw.providerEventId,
      bookingId: raw.bookingId,
      status: raw.status,
      occurredAt: new Date(raw.occurredAt),
    };

    if (!isPaymentWebhookEvent(event)) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    return { ok: true, event };
  },
};
