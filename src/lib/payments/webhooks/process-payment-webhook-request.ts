import "server-only";
import { logger } from "@/lib/logger";
import { getPaymentWebhookVerifier, type PaymentWebhookVerifierKey } from "./security/get-payment-webhook-verifier";
import type { RawPaymentWebhookRequest } from "./security/payment-webhook-verifier";
import { getPaymentWebhookAdapter, type PaymentWebhookAdapterKey } from "./adapters/get-payment-webhook-adapter";
import { processPaymentWebhookEvent } from "./process-payment-webhook-event";

// Payment Webhook Pipeline — Phase 2.20 (Payment Webhook Pipeline
// Foundation). The Composition Root this codebase's own architecture
// diagram has described since Phase 2.17: Raw Request -> Verifier ->
// Verified Payload -> Adapter -> Canonical Event ->
// processPaymentWebhookEvent() -> Database. Phases 2.17/2.18/2.19 each
// deliberately deferred building this exact function — their own module
// comments state a composition/dispatch layer "would be an abstraction
// with nothing yet to abstract over" until all three independent layers
// (Verifier, Adapter, Payment Domain) existed. They now do; this phase
// is only that composition, nothing else.
//
// ZERO BUSINESS RULES MOVED: every call below is a straight pass-through
// to an already-existing, already-tested function. This file contains
// no signature logic (that's the Verifier's), no field-reshaping logic
// (that's the Adapter's), and no eligibility/persistence/audit logic
// (that's processPaymentWebhookEvent()'s) — it only sequences them and
// maps each stage's own already-existing result type into one unified
// shape, per this phase's own "Result Model" instruction.
//
// KEY SELECTION: verifierKey/adapterKey are optional pass-throughs to
// each factory's own default parameter (getPaymentWebhookVerifier's own
// "NONE", getPaymentWebhookAdapter's own "GENERIC") — this file never
// hardcodes which default is "correct" itself, keeping that single
// source of truth exactly where Phases 2.18/2.19 already put it.
//
// WHY THE OUTER TRY/CATCH: this is "the single orchestration entry
// point future HTTP routes will call" (this phase's own framing) — the
// same boundary role capture-payment.ts/deactivate-price.ts play for
// their own callers. Mirroring their exact shape: any unexpected throw
// (today, only reachable via the NONE verifier's deliberate
// "no real verifier is configured" throw — see
// no-op-payment-webhook-verifier.ts's own comment for why that stays a
// throw, not a returned result) is caught here, logged server-side
// only, and converted into one generic, non-leaking result — exactly
// like every existing admin action's own outer catch converts an
// unexpected exception into UNKNOWN_ERROR rather than letting it
// propagate to the caller.

export type PaymentWebhookPipelineResult =
  | { ok: true; applied: true }
  | { ok: true; applied: false; reason: "ALREADY_PROCESSED" }
  | { ok: false; stage: "VERIFICATION"; error: "INVALID_SIGNATURE" | "MALFORMED_REQUEST" }
  | { ok: false; stage: "TRANSLATION"; error: "INVALID_PAYLOAD" }
  | { ok: false; stage: "PROCESSING"; error: "INVALID_EVENT" | "PAYMENT_NOT_FOUND" | "UNSUPPORTED_STATUS" }
  | { ok: false; stage: "UNKNOWN"; error: "UNKNOWN_ERROR" };

export interface ProcessPaymentWebhookRequestOptions {
  verifierKey?: PaymentWebhookVerifierKey;
  adapterKey?: PaymentWebhookAdapterKey;
}

export async function processPaymentWebhookRequest(
  request: RawPaymentWebhookRequest,
  options: ProcessPaymentWebhookRequestOptions = {}
): Promise<PaymentWebhookPipelineResult> {
  try {
    const verifier = getPaymentWebhookVerifier(options.verifierKey);
    const verification = verifier.verify(request);

    if (!verification.ok) {
      return { ok: false, stage: "VERIFICATION", error: verification.error };
    }

    const adapter = getPaymentWebhookAdapter(options.adapterKey);
    const translation = adapter.translate(verification.payload);

    if (!translation.ok) {
      return { ok: false, stage: "TRANSLATION", error: translation.error };
    }

    const result = await processPaymentWebhookEvent(translation.event);

    if (!result.ok) {
      return { ok: false, stage: "PROCESSING", error: result.error };
    }

    return result;
  } catch (error) {
    // Never expose Prisma/internal/configuration exception details to
    // the caller; log server-side only and return the generic stage,
    // matching capture-payment.ts/deactivate-price.ts.
    logger.error("processPaymentWebhookRequest.unexpected_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" };
  }
}
