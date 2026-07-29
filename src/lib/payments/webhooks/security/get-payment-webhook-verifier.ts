import "server-only";
import type { PaymentWebhookVerifier } from "./payment-webhook-verifier";
import { noOpPaymentWebhookVerifier } from "./providers/no-op-payment-webhook-verifier";
import { stripePaymentWebhookVerifier } from "./providers/stripe-payment-webhook-verifier";

// Payment Webhook Verifier Factory — Phase 2.19 (Payment Webhook
// Security Foundation). The ONLY place that selects a webhook verifier
// by key — mirrors get-payment-gateway-provider.ts (Phase 2.15) and
// get-payment-webhook-adapter.ts (Phase 2.18) exactly, including the
// reserved-future-key shape. Adding a real vendor's verifier later is:
// implement PaymentWebhookVerifier, add one `case` here — no other file
// changes.
//
// Reuses the identical vendor key vocabulary as PaymentGatewayProviderKey
// and PaymentWebhookAdapterKey (STRIPE, PAYPAL, OMANNET, APPLE_PAY,
// GOOGLE_PAY, BANK_API) — a future real vendor is always added as a
// matched trio: a gateway, a webhook adapter, and a webhook verifier.
//
// Default key is "NONE", not "GENERIC": unlike the webhook adapter
// (where a genuinely working, vendor-neutral default exists — see
// generic-payment-webhook-adapter.ts's own comment), there is no honest
// working default for signature verification — see
// no-op-payment-webhook-verifier.ts's own comment for why it throws
// rather than returning a result. "NONE" mirrors the payment gateway
// factory's own naming for this same "no real backing exists yet"
// category.
//
// STRIPE is no longer reserved as of Phase 2.22 (First Payment
// Provider): it now resolves to a real verifier using Stripe's own SDK
// for signature verification.
//
// PROVIDER RESOLUTION — Phase 2.22A (Provider Selection Architecture
// Refinement): now takes an OPTIONAL key, mirroring
// get-payment-gateway-provider.ts's own resolution exactly — an
// explicit caller-supplied key still wins, an omitted key resolves from
// the same PAYMENT_PROVIDER env var the Gateway and Adapter factories
// read, so a real vendor is always selected as one matched trio. "NONE"
// already is this factory's own off-key (unlike the Adapter's
// "GENERIC"), so no alias mapping is needed here.

export type PaymentWebhookVerifierKey =
  | "NONE"
  | "STRIPE"
  | "PAYPAL"
  | "OMANNET"
  | "APPLE_PAY"
  | "GOOGLE_PAY"
  | "BANK_API";

const RESERVED_FUTURE_VERIFIERS: readonly PaymentWebhookVerifierKey[] = [
  "PAYPAL",
  "OMANNET",
  "APPLE_PAY",
  "GOOGLE_PAY",
  "BANK_API",
];

export function getPaymentWebhookVerifier(key?: PaymentWebhookVerifierKey): PaymentWebhookVerifier {
  const resolvedKey = key ?? ((process.env.PAYMENT_PROVIDER as PaymentWebhookVerifierKey | undefined) || "NONE");

  if (resolvedKey === "NONE") {
    return noOpPaymentWebhookVerifier;
  }

  if (resolvedKey === "STRIPE") {
    return stripePaymentWebhookVerifier;
  }

  if (RESERVED_FUTURE_VERIFIERS.includes(resolvedKey)) {
    throw new Error(`getPaymentWebhookVerifier: "${resolvedKey}" is a reserved future payment webhook verifier — not implemented yet.`);
  }

  throw new Error(`getPaymentWebhookVerifier: unknown payment webhook verifier key "${resolvedKey}"`);
}
