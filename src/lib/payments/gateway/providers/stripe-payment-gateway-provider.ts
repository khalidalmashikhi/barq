import "server-only";
import Stripe from "stripe";
import {
  PaymentGatewayPendingError,
  type PaymentGatewayProvider,
  type PaymentGatewayInitiateRequest,
  type PaymentGatewayCaptureRequest,
  type PaymentGatewayRefundRequest,
  type PaymentGatewayResult,
} from "../payment-gateway-provider";

// Stripe Gateway Provider — Phase 2.22 (First Payment Provider). The
// reference real-vendor implementation of PaymentGatewayProvider
// (Phase 2.15) — the interface itself required zero changes to
// accommodate a real vendor, exactly as that phase's own comment
// predicted ("A future real gateway is a new PaymentGatewayProvider
// implementation selected by get-payment-gateway-provider.ts; no other
// file changes").
//
// CREDENTIALS: STRIPE_SECRET_KEY is read from the environment at call
// time, never hardcoded — mirrors twilio-provider.ts's own
// TWILIO_AUTH_TOKEN handling (Phase D.4). Left OPTIONAL in
// scripts/env-schema.ts (see that file's own comment): nothing in this
// codebase selects "STRIPE" as its Gateway yet — accept-booking.ts and
// capture-payment.ts still request "NONE", unchanged, per this phase's
// own "Everything else must remain unchanged" scope. A missing key
// throws a clear error at the point of use rather than failing
// environment validation for every deployment that doesn't yet use
// Stripe, mirroring noOpPaymentGatewayProvider's own "throw with a
// clear message" precedent for a different reason (missing
// configuration, not "no real gateway exists at all").
//
// STATUS MAPPING: reuses Prisma's own PaymentStatus verbatim, per
// payment-gateway-provider.ts's own "Reuse the existing PaymentStatus
// enum. Do not redesign" discipline — Stripe's own PaymentIntent.status
// vocabulary ('succeeded' | 'canceled' | 'processing' |
// 'requires_action' | 'requires_capture' | 'requires_confirmation' |
// 'requires_payment_method') is translated down to exactly CAPTURED or
// FAILED; no new status value is invented here.
//
// METADATA LINKAGE: initiate() stores bookingId in the PaymentIntent's
// own `metadata` field — the only place Stripe lets a caller attach an
// arbitrary application-side identifier to a PaymentIntent.
// stripe-payment-webhook-adapter.ts (this same phase) reads it back out
// of a webhook event's `data.object.metadata.bookingId` to resolve which
// Payment a webhook event concerns, since Payment.bookingId (not a
// stored provider reference) remains this codebase's one real lookup
// key (see payment-webhook-event.ts's own comment).
//
// capture_method: "manual" is required so capture() can be called as
// its own, later step — Stripe's default behavior captures immediately
// on confirmation, which would collapse this codebase's own
// Initiated -> Captured two-step Payment lifecycle into one step.
//
// REFUND — Phase 2.29 (Refund Transaction): the first real
// implementation, mirroring capture()'s own shape exactly (require
// providerReference, get the client, call the real Stripe endpoint with
// an idempotency key, map the response to an existing PaymentStatus).
// no-op-payment-gateway-provider.ts's refund() still throws, unchanged —
// there remains no honest no-op for a real financial refund (Phase
// 2.15's own reasoning), so the No-Op provider is deliberately not
// touched this phase; only the real Stripe vendor gets a genuine
// implementation, exactly like capture() before it.
//
// FULL VS PARTIAL: request.amount's Phase 2.27 meaning carries through
// unchanged — omitted means "refund the entire remaining amount" (no
// `amount` sent to Stripe, which defaults to a full refund of the
// PaymentIntent's charge); a Decimal string means refund exactly that
// amount. The returned status is REFUNDED_FULL when no amount was
// requested, REFUNDED_PARTIAL when one was — refund-payment.ts (Phase
// 2.28/2.29) is the only caller, and it only ever calls this with an
// amount it already validated against the Payment's own original total,
// so this simple presence/absence rule and that caller's own validation
// always agree; see that file's own comment for why a more elaborate
// cumulative-refund calculation inside the gateway itself was judged
// unnecessary (canRefundPayment() only ever allows a single refund
// attempt per Payment today).
//
// FAILURE: if Stripe's own Refund.status is not "succeeded", this
// throws rather than returning a PaymentGatewayResult with status
// FAILED — unlike capture()'s CAPTURED/FAILED duality. A failed refund
// ATTEMPT must never be confused with the Payment's own FAILED state
// (reserved for a failed CAPTURE — DOMAIN_MODEL.md's lifecycle) since
// the money was already genuinely captured; throwing routes this
// through refund-payment.ts's existing catch-all UNKNOWN_ERROR path,
// which persists nothing, leaving the Payment correctly still CAPTURED.
//
// PENDING/ASYNCHRONOUS OUTCOMES — Phase 2.29A (Refund Transaction
// Remediation): the installed SDK's own Refunds.d.ts documents five
// real statuses — "pending", "requires_action", "succeeded", "failed",
// "canceled" — not just succeeded-or-not. "pending"/"requires_action"
// are NOT terminal failures: some refund methods settle asynchronously
// and may still resolve to "succeeded" later (Stripe's own refund/
// charge.refund.updated webhook is how a real integration would learn
// that — explicitly out of scope for this codebase; see refund-payment.ts's
// own comment for how it still avoids losing track of this case without
// one). This file throws PaymentGatewayPendingError (a provider-agnostic
// type from payment-gateway-provider.ts, not defined here) specifically
// for those two statuses, distinct from the plain Error thrown for a
// genuinely terminal "failed"/"canceled" outcome — refund-payment.ts
// catches the two differently.
//
// GATEWAY IDEMPOTENCY — Phase 2.26 (Gateway Idempotency): Phase 2.25
// closed the local database race (two concurrent capturePayment() calls
// can no longer both finalize), but a genuinely concurrent pair of
// requests can still both reach this file's initiate()/capture() before
// either's transaction commits — the remaining exposure is at the
// gateway boundary itself. Both calls now pass Stripe's own
// idempotencyKey request option (RequestOptions.idempotencyKey, per the
// installed SDK's own lib.d.ts): if Stripe has already seen the same key
// (within its own retention window), it returns the ORIGINAL response
// instead of performing the operation again — this is Stripe's native,
// documented answer to exactly this problem
// (https://stripe.com/docs/api/idempotent_requests), not something this
// codebase invents or approximates.
//
// KEY DERIVATION: buildIdempotencyKey() below is a pure, deterministic
// function of an identifier this codebase already has in hand — no new
// persistence, no generated token, no Idempotency table. initiate()
// keys off request.bookingId: Payment.bookingId is @unique and
// accept-booking.ts's own CONFIRMED-once transition means at most one
// real initiate() attempt is ever legitimate per booking, so two
// concurrent (or retried) initiate() calls for the same booking always
// produce the same key, and Stripe itself collapses them to one
// PaymentIntent. capture() keys off request.providerReference — the
// Stripe PaymentIntent id itself, already a unique identifier Stripe
// assigned — so two concurrent (or retried) capture() calls against the
// same PaymentIntent always produce the same key.
//
// REFUND KEY — Phase 2.29A (Refund Transaction Remediation) fixed a
// real safety gap: the original Phase 2.29 key included the requested
// amount (`providerReference:amount`), meaning two concurrent
// refundPayment() calls for the same Payment with two DIFFERENT amounts
// would carry two DIFFERENT idempotency keys — Stripe would treat them
// as two unrelated, genuinely independent refund requests and could
// execute BOTH externally before either local transaction's updateMany
// guard (Phase 2.25's pattern) ever ran, since that guard only protects
// this codebase's own database, not a second real Stripe API call
// already in flight. canRefundPayment() permits only one refund
// operation per Payment (see payment-status-policy.ts), so the correct
// key is providerReference ALONE, independent of amount: two concurrent
// (or retried) refund() calls against the same PaymentIntent — whatever
// amount each one requests — now always carry the SAME idempotency key.
// If their parameters differ (different amounts), Stripe's own
// idempotency-key semantics reject the second request as a key/parameter
// mismatch (a real Stripe API error, not something this codebase
// fabricates) rather than performing a second, conflicting refund —
// this is Stripe's documented behavior for reusing a key with different
// parameters, not an assumption. See
// stripe-payment-gateway-provider.test.ts's own concurrent test for the
// simulated proof.

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "stripePaymentGatewayProvider: STRIPE_SECRET_KEY is not configured — this environment cannot call the real Stripe API."
    );
  }
  return new Stripe(secretKey);
}

function mapStripePaymentIntentStatus(status: Stripe.PaymentIntent.Status): PaymentGatewayResult["status"] {
  return status === "succeeded" ? "CAPTURED" : "FAILED";
}

// See this file's own "GATEWAY IDEMPOTENCY" comment above for why this
// must be a pure function of an existing identifier, not a generated
// value.
function buildIdempotencyKey(operation: "initiate" | "capture" | "refund", identifier: string): string {
  return `barq:payment:${operation}:${identifier}`;
}

// MONEY-SAFE MINOR-UNITS CONVERSION — Phase 2.22A (Provider Selection
// Architecture Refinement). Replaces the original Phase 2.22
// `Math.round(Number(request.amount) * 100)`, which performed a
// floating-point multiplication before rounding — the well-known class
// of bug where e.g. 19.99 * 100 can produce 1998.9999999999998 in IEEE
// 754 double-precision arithmetic. `Math.round` happened to mask every
// case this codebase's own Decimal(12,2)-sourced amounts ever produced,
// but masking is not the same as correctness, and this phase's own
// "harden precision" instruction asks for the real thing: parse the
// decimal string's whole/fractional parts directly and combine them
// with integer arithmetic only — no float multiplication ever occurs.
// Not a payment-model redesign: amount is still carried as the same
// Decimal-string this codebase already uses everywhere (see
// payment-gateway-provider.ts's own comment on why), only how this one
// file converts it to Stripe's required minor-unit integer changed.
function toStripeMinorUnits(amount: string): number {
  const [wholePart = "0", fractionPart = ""] = amount.split(".");
  const whole = Number.parseInt(wholePart, 10);
  const fraction = Number.parseInt((fractionPart + "00").slice(0, 2), 10);

  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) {
    throw new Error(`stripePaymentGatewayProvider: invalid amount "${amount}"`);
  }

  return whole * 100 + fraction;
}

export const stripePaymentGatewayProvider: PaymentGatewayProvider = {
  key: "STRIPE",

  async initiate(request: PaymentGatewayInitiateRequest): Promise<PaymentGatewayResult> {
    const stripe = getStripeClient();

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: toStripeMinorUnits(request.amount),
        currency: request.currency.toLowerCase(),
        metadata: { bookingId: request.bookingId },
        capture_method: "manual",
      },
      { idempotencyKey: buildIdempotencyKey("initiate", request.bookingId) }
    );

    return {
      status: "INITIATED",
      providerReference: paymentIntent.id,
      occurredAt: new Date(),
    };
  },

  async capture(request: PaymentGatewayCaptureRequest): Promise<PaymentGatewayResult> {
    if (!request.providerReference) {
      throw new Error("stripePaymentGatewayProvider.capture: providerReference (Stripe PaymentIntent id) is required.");
    }

    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.capture(request.providerReference, undefined, {
      idempotencyKey: buildIdempotencyKey("capture", request.providerReference),
    });

    return {
      status: mapStripePaymentIntentStatus(paymentIntent.status),
      providerReference: paymentIntent.id,
      occurredAt: new Date(),
    };
  },

  async refund(request: PaymentGatewayRefundRequest): Promise<PaymentGatewayResult> {
    if (!request.providerReference) {
      throw new Error("stripePaymentGatewayProvider.refund: providerReference (Stripe PaymentIntent id) is required.");
    }

    const stripe = getStripeClient();
    const isPartial = request.amount !== undefined;

    const refund = await stripe.refunds.create(
      {
        payment_intent: request.providerReference,
        ...(isPartial ? { amount: toStripeMinorUnits(request.amount as string) } : {}),
      },
      // Keyed on providerReference ALONE — see this file's own "REFUND
      // KEY" comment for why the requested amount must never be part of
      // this key.
      { idempotencyKey: buildIdempotencyKey("refund", request.providerReference) }
    );

    if (refund.status === "pending" || refund.status === "requires_action") {
      throw new PaymentGatewayPendingError(
        `stripePaymentGatewayProvider.refund: Stripe reported refund status "${refund.status}" — accepted but not yet confirmed.`
      );
    }

    if (refund.status !== "succeeded") {
      throw new Error(`stripePaymentGatewayProvider.refund: Stripe reported refund status "${refund.status}", not "succeeded".`);
    }

    return {
      status: isPartial ? "REFUNDED_PARTIAL" : "REFUNDED_FULL",
      providerReference: request.providerReference,
      occurredAt: new Date(),
    };
  },
};
