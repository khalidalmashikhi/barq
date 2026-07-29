import "server-only";
import type { PaymentWebhookAdapter } from "./payment-webhook-adapter";
import { genericPaymentWebhookAdapter } from "./providers/generic-payment-webhook-adapter";
import { stripePaymentWebhookAdapter } from "./providers/stripe-payment-webhook-adapter";

// Payment Webhook Adapter Factory — Phase 2.18 (Payment Webhook Adapter
// Foundation). The ONLY place that selects a webhook adapter by key —
// mirrors get-payment-gateway-provider.ts (Phase 2.15) exactly,
// including its reserved-future-key shape. Adding a real vendor adapter
// later is: implement PaymentWebhookAdapter, add one `case` here — no
// other file changes.
//
// Reuses the identical vendor key vocabulary as
// PaymentGatewayProviderKey (STRIPE, PAYPAL, OMANNET, APPLE_PAY,
// GOOGLE_PAY, BANK_API) — a future real gateway and its matching
// webhook adapter are always added together, so the key names line up
// across both factories by design, even though this is a separate type
// (a webhook adapter and a payment gateway are different capabilities
// that happen to share the same set of future vendors).
//
// Default key is "GENERIC", not "NONE": unlike the payment gateway
// (where "NONE" means "no real gateway exists, most operations are
// unsafe to fake"), the default adapter here is a genuinely working
// translator (see generic-payment-webhook-adapter.ts's own comment) —
// naming it "NONE" would misrepresent it as a non-functional
// placeholder, which it isn't.
//
// STRIPE is no longer reserved as of Phase 2.22 (First Payment
// Provider): it now resolves to a real translator
// (stripe-payment-webhook-adapter.ts).
//
// PROVIDER RESOLUTION — Phase 2.22A (Provider Selection Architecture
// Refinement): now takes an OPTIONAL key, mirroring
// get-payment-gateway-provider.ts's own resolution exactly — an
// explicit caller-supplied key still wins, an omitted key resolves from
// the same PAYMENT_PROVIDER env var the Gateway and Verifier factories
// read, so a real vendor is always selected as one matched trio.
//
// "NONE" -> "GENERIC" ALIAS: PAYMENT_PROVIDER's own "off" sentinel is
// the string "NONE" (matching the Gateway/Verifier's own off-key
// value), but "NONE" was deliberately never added to
// PaymentWebhookAdapterKey itself (see this file's own comment above on
// why "GENERIC" is a real working default, not a placeholder needing a
// "NONE"-style name). Rather than redesign that naming decision, this
// factory treats configuration-level "NONE" (or an unset env var) as
// meaning "use GENERIC" — the same configuration value drives all three
// factories consistently, while each factory keeps its own internal
// vocabulary for what its off-state object is actually called.

export type PaymentWebhookAdapterKey =
  | "GENERIC"
  | "STRIPE"
  | "PAYPAL"
  | "OMANNET"
  | "APPLE_PAY"
  | "GOOGLE_PAY"
  | "BANK_API";

const RESERVED_FUTURE_ADAPTERS: readonly PaymentWebhookAdapterKey[] = [
  "PAYPAL",
  "OMANNET",
  "APPLE_PAY",
  "GOOGLE_PAY",
  "BANK_API",
];

export function getPaymentWebhookAdapter(key?: PaymentWebhookAdapterKey): PaymentWebhookAdapter {
  const configuredKey = key ?? (process.env.PAYMENT_PROVIDER as PaymentWebhookAdapterKey | undefined);
  const resolvedKey: PaymentWebhookAdapterKey =
    !configuredKey || (configuredKey as string) === "NONE" ? "GENERIC" : configuredKey;

  if (resolvedKey === "GENERIC") {
    return genericPaymentWebhookAdapter;
  }

  if (resolvedKey === "STRIPE") {
    return stripePaymentWebhookAdapter;
  }

  if (RESERVED_FUTURE_ADAPTERS.includes(resolvedKey)) {
    throw new Error(`getPaymentWebhookAdapter: "${resolvedKey}" is a reserved future payment webhook adapter — not implemented yet.`);
  }

  throw new Error(`getPaymentWebhookAdapter: unknown payment webhook adapter key "${resolvedKey}"`);
}
