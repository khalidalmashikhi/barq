import "server-only";

// Payment provider health check — Production Hardening.
//
// UNLIKE getOtpProvider(), getPaymentGatewayProvider() does NOT validate
// STRIPE_SECRET_KEY eagerly — stripePaymentGatewayProvider reads it
// lazily, only at the moment initiate()/capture()/refund() is actually
// called (see that file's own getStripeClient()). Calling the factory
// here would therefore never catch "PAYMENT_PROVIDER=STRIPE but the
// secret is missing" — this check performs that presence validation
// itself instead, without ever calling the real gateway or exposing the
// secret's value.

export type PaymentProviderHealth = "NONE" | "STRIPE" | "misconfigured";

export function checkPaymentProviderHealth(): PaymentProviderHealth {
  const providerKey = process.env.PAYMENT_PROVIDER || "NONE";

  if (providerKey === "NONE") return "NONE";

  if (providerKey === "STRIPE") {
    return process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET ? "STRIPE" : "misconfigured";
  }

  return "misconfigured";
}
