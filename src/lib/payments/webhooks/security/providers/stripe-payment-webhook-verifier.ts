import "server-only";
import Stripe from "stripe";
import type {
  PaymentWebhookVerifier,
  PaymentWebhookVerificationResult,
  RawPaymentWebhookRequest,
} from "../payment-webhook-verifier";

// Stripe Webhook Verifier — Phase 2.22 (First Payment Provider). Real
// signature verification via Stripe's own SDK
// (Stripe.webhooks.constructEvent) — per this phase's own "No custom
// verification algorithm. Use Stripe's official SDK" instruction, this
// file never reimplements HMAC/timestamp-window comparison itself; the
// SDK owns that entirely.
//
// STATIC, NOT INSTANCE — DELIBERATE ISOLATION: Stripe.webhooks is a
// static property (confirmed against the installed SDK's own type
// declarations), requiring no client instance and no STRIPE_SECRET_KEY
// at all — verifying a webhook signature only ever needs the webhook
// signing secret, never the API secret key. This is a real, meaningful
// isolation property (see this phase's own Pattern Regression Check
// "verifier isolation" requirement): this file has zero dependency on
// stripe-payment-gateway-provider.ts's own credential.
//
// STRIPE_WEBHOOK_SECRET is read from the environment at call time,
// never hardcoded. Left OPTIONAL in scripts/env-schema.ts; a missing
// secret throws here — caught by processPaymentWebhookRequest()'s own
// outer catch (Phase 2.20) and mapped to a 500 by the webhook route
// (Phase 2.21), preserving the exact same "reachable but functionally
// inert without real configuration" property this codebase established
// for the NONE verifier (see no-op-payment-webhook-verifier.ts's own
// comment) — just for a more specific reason now.
//
// STRIPE-SIGNATURE HEADER: Stripe's own required header for
// constructEvent(); its absence or an unparseable/invalid signature
// both surface as the SDK's own thrown error, caught here and reported
// as INVALID_SIGNATURE — this file makes no attempt to distinguish
// "signature present but wrong" from "signature malformed" beyond what
// the SDK itself reports, since inventing a second, custom verification
// path for that distinction would contradict "No custom verification
// algorithm."
//
// PAYLOAD: `payload` is the SDK's own parsed, already-verified
// Stripe.Event object — stripe-payment-webhook-adapter.ts (this same
// phase) is the only place that ever inspects its fields; this file
// never interprets event.type or event.data itself, per this
// codebase's established "authenticity only" verifier responsibility
// (Phase 2.19).

export const stripePaymentWebhookVerifier: PaymentWebhookVerifier = {
  key: "STRIPE",

  verify(request: RawPaymentWebhookRequest): PaymentWebhookVerificationResult {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error(
        "stripePaymentWebhookVerifier.verify: STRIPE_WEBHOOK_SECRET is not configured — signature verification cannot run."
      );
    }

    const signatureHeader = request.headers["stripe-signature"];
    if (!signatureHeader) {
      return { ok: false, error: "MALFORMED_REQUEST" };
    }

    try {
      const event = Stripe.webhooks.constructEvent(request.body, signatureHeader, webhookSecret);
      return { ok: true, payload: event, providerEventId: event.id };
    } catch {
      return { ok: false, error: "INVALID_SIGNATURE" };
    }
  },
};
