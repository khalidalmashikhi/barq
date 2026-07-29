import "server-only";
import type { PaymentWebhookEvent } from "../payment-webhook-event";

// Payment Webhook Adapter Interface — Phase 2.18 (Payment Webhook
// Adapter Foundation). Mirrors this codebase's own established
// provider-abstraction shape exactly: src/lib/payments/gateway/
// payment-gateway-provider.ts (Phase 2.15), src/lib/otp/provider.ts
// (Phase D.4), and signature-providers/signature-provider.ts (Phase
// E.3) each define an interface + request/result types + a single
// factory that selects an implementation by key — no other file ever
// branches on a vendor name. This is that same pattern applied to
// inbound webhook payload translation.
//
// SINGLE RESPONSIBILITY — TRANSLATION ONLY: an adapter's only job is
// reshaping a provider's own payload into this codebase's existing
// canonical PaymentWebhookEvent (see payment-webhook-event.ts, Phase
// 2.17) — it must contain zero business rules. Eligibility (can this
// Payment be captured?), idempotency (was this event already applied?),
// persistence, and audit all remain exclusively inside
// processPaymentWebhookEvent() — untouched by this phase, per its own
// explicit "Reuse everything already implemented. Do NOT redesign."
//
// SYNCHRONOUS BY DESIGN: unlike PaymentGatewayProvider's methods (which
// perform, or will one day perform, real gateway I/O), translate() is
// pure data reshaping — no network call, no SDK, no secret, matching
// this phase's own "No REST. No SDK. No Signature Verification." A
// provider payload needing real signature verification would perform
// that verification at the point where its raw payload is first
// received (outside this adapter, and outside this phase's scope
// entirely) — translate() only ever sees a payload already accepted for
// processing.

export type PaymentWebhookAdapterResult =
  | { ok: true; event: PaymentWebhookEvent }
  | { ok: false; error: "INVALID_PAYLOAD" };

export interface PaymentWebhookAdapter {
  readonly key: string;
  translate(payload: unknown): PaymentWebhookAdapterResult;
}
