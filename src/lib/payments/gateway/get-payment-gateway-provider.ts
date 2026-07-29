import "server-only";
import type { PaymentGatewayProvider } from "./payment-gateway-provider";
import { noOpPaymentGatewayProvider } from "./providers/no-op-payment-gateway-provider";
import { stripePaymentGatewayProvider } from "./providers/stripe-payment-gateway-provider";

// Payment Gateway Provider Factory — Phase 2.15. The ONLY place that
// selects a payment gateway by key — mirrors get-signature-provider.ts
// (Phase E.3) exactly, including its reserved-future-key shape (which
// itself mirrors get-contract-template.ts's GOVERNMENT handling, Phase
// E.2). Adding a real vendor later is: implement PaymentGatewayProvider,
// add one `case` here — no other file changes, per this phase's own
// goal ("future providers... plug in without modifying Booking, Payment
// or Invoice logic").
//
// PAYPAL, OMANNET, APPLE_PAY, GOOGLE_PAY, and BANK_API remain this
// phase's own explicitly-named future providers — recognized keys that
// throw a clear, distinct error today (reserved, not implemented)
// rather than silently falling back to the wrong provider. STRIPE is
// no longer reserved as of Phase 2.22 (First Payment Provider): it now
// resolves to a real implementation.
//
// PROVIDER RESOLUTION — Phase 2.22A (Provider Selection Architecture
// Refinement): now takes an OPTIONAL key, mirroring get-otp-provider.ts
// exactly (Phase D.4's `getOtpProvider()` reads OTP_PROVIDER with zero
// parameters) — an explicit caller-supplied key still wins, an omitted
// key now resolves from PAYMENT_PROVIDER instead of a hardcoded "NONE"
// literal. This is the same "configuration change only, no code path
// outside this file branches on vendor name" property OTP_PROVIDER
// already established.
//
// accept-booking.ts and capture-payment.ts (Phase 2.23 — Payment
// Gateway Runtime Wiring) now also omit the key entirely, exactly like
// the webhook route — every real caller in this codebase resolves
// through PAYMENT_PROVIDER today; no caller anywhere still hardcodes a
// literal gateway key.
//
// Not memoized, for the identical reason get-otp-provider.ts gives: env
// vars are only read at process start in this deployment model, and
// constructing a provider is cheap.

export type PaymentGatewayProviderKey = "NONE" | "STRIPE" | "PAYPAL" | "OMANNET" | "APPLE_PAY" | "GOOGLE_PAY" | "BANK_API";

const RESERVED_FUTURE_PROVIDERS: readonly PaymentGatewayProviderKey[] = [
  "PAYPAL",
  "OMANNET",
  "APPLE_PAY",
  "GOOGLE_PAY",
  "BANK_API",
];

export function getPaymentGatewayProvider(key?: PaymentGatewayProviderKey): PaymentGatewayProvider {
  const resolvedKey = key ?? ((process.env.PAYMENT_PROVIDER as PaymentGatewayProviderKey | undefined) || "NONE");

  if (resolvedKey === "NONE") {
    return noOpPaymentGatewayProvider;
  }

  if (resolvedKey === "STRIPE") {
    return stripePaymentGatewayProvider;
  }

  if (RESERVED_FUTURE_PROVIDERS.includes(resolvedKey)) {
    throw new Error(`getPaymentGatewayProvider: "${resolvedKey}" is a reserved future payment gateway — not implemented yet.`);
  }

  throw new Error(`getPaymentGatewayProvider: unknown payment gateway provider key "${resolvedKey}"`);
}
