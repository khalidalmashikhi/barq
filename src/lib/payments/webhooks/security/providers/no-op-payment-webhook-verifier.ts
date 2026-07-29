import "server-only";
import type {
  PaymentWebhookVerifier,
  PaymentWebhookVerificationResult,
  RawPaymentWebhookRequest,
} from "../payment-webhook-verifier";

// No-Op Payment Webhook Verifier — Phase 2.19 (Payment Webhook Security
// Foundation). Mirrors no-op-payment-gateway-provider.ts's capture()/
// refund() precedent exactly, not generic-payment-webhook-adapter.ts's
// (Phase 2.18) genuinely-working default: unlike payload translation
// (harmless data reshaping, where a real working default is honest),
// there is no honest no-op for signature verification — claiming
// ok:true would misrepresent that cryptographic verification actually
// occurred, when nothing was checked at all. Since this phase's own
// scope explicitly forbids Secrets/Environment Variables/API Keys, no
// real verifier can exist yet regardless of vendor.
//
// THROWS, RATHER THAN RETURNING { ok: false }: a returned
// { ok: false, error: "INVALID_SIGNATURE" } would read as "this specific
// request had a bad signature" — a normal, expected per-request outcome
// a real verifier's caller should handle routinely. "No verifier is
// configured at all" is a materially different, exceptional condition
// (a deployment/configuration error, not a request-level rejection) and
// must not be silently absorbed into that same code path — throwing
// forces any future caller to handle it explicitly, exactly like
// noOpPaymentGatewayProvider.capture()/refund()'s own throwing
// precedent.

export const noOpPaymentWebhookVerifier: PaymentWebhookVerifier = {
  key: "NONE",

  verify(request: RawPaymentWebhookRequest): PaymentWebhookVerificationResult {
    void request;
    throw new Error(
      "noOpPaymentWebhookVerifier.verify: no real Payment Webhook Verifier is configured — signature verification has not been implemented yet."
    );
  },
};
