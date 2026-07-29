import { NextResponse } from "next/server";
import {
  processPaymentWebhookRequest,
  type PaymentWebhookPipelineResult,
} from "@/lib/payments/webhooks/process-payment-webhook-request";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Payment Webhook HTTP Endpoint — Phase 2.21 (Payment Webhook HTTP
// Endpoint Foundation), made provider-neutral again in Phase 2.22A
// (Provider Selection Architecture Refinement) after briefly hardcoding
// "STRIPE" in Phase 2.22. The transport layer for the Composition Root
// Phase 2.20 already built: this route's entire job is reading the raw
// request off the wire and handing it, unmodified, to
// processPaymentWebhookRequest() — every real decision (authenticity,
// translation, business rules) already lives there and in the layers it
// composes. Mirrors this codebase's own thin-wrapper API route
// convention exactly (src/app/api/health/route.ts,
// src/app/api/cron/expire-stale-bookings/route.ts): the route contains
// no logic that isn't itself directly unit-testable without an HTTP
// request.
//
// RAW BODY, NOT PARSED: request.text() reads the exact bytes the sender
// posted — request.json() would silently reserialize/normalize the body
// before a future real verifier ever saw it, which could invalidate a
// signature computed over the original bytes (see
// payment-webhook-verifier.ts's own comment on why raw body matters).
//
// HEADERS: Headers.entries() already yields lowercased header names per
// the Fetch spec, matching RawPaymentWebhookRequest's own "lowercased
// header names" contract — no extra normalization needed here.
//
// PROVIDER-NEUTRAL BY DESIGN — Phase 2.22A: this route no longer passes
// any options to processPaymentWebhookRequest() at all — no
// verifierKey, no adapterKey, and critically, no mention of "STRIPE"
// anywhere in this file. Each factory (getPaymentWebhookVerifier,
// getPaymentWebhookAdapter) now resolves its own key from the
// PAYMENT_PROVIDER environment variable when the pipeline omits an
// explicit one (see each factory's own comment) — the exact same
// "configuration change only, no code path outside the factory branches
// on vendor name" property this codebase already established for
// OTP_PROVIDER (Phase D.4). This route is the thing that gets deployed
// once and never touched again when a vendor changes; only
// PAYMENT_PROVIDER (and that vendor's own secrets) do.
//
// SECURITY PROPERTY, STILL PRESERVED: with PAYMENT_PROVIDER unset in
// this environment, both factories resolve to their own "off" default
// (NONE/GENERIC) exactly as they did before Stripe existed — every
// request still resolves through the No-Op verifier, which always
// throws, caught by the pipeline and mapped below to 500. Setting
// PAYMENT_PROVIDER=STRIPE without STRIPE_WEBHOOK_SECRET configured
// preserves the identical fail-closed 500, now via the Stripe verifier
// instead. The endpoint can never cause a Payment mutation without
// both PAYMENT_PROVIDER and that vendor's real secrets being configured
// together.
//
// NO EXTRA LOGGING HERE: withRequestTracing() already logs exactly one
// line per request (status, duration, requestId) on completion — this
// codebase's own established "quiet rather than noisy" observability
// convention (see that module's own comment). Adding a second log line
// here would duplicate it, not extend it.
//
// STATUS CODE MAPPING — the route's one real transport-level decision,
// not a business rule: translating an already-computed pipeline outcome
// into wire semantics, never re-inspecting Payment/Booking state itself.
//   - ok (applied, or already processed)  -> 200
//   - VERIFICATION / INVALID_SIGNATURE     -> 401
//   - VERIFICATION / MALFORMED_REQUEST     -> 400
//   - TRANSLATION  / INVALID_PAYLOAD        -> 400
//   - PROCESSING   / INVALID_EVENT          -> 400
//   - PROCESSING   / PAYMENT_NOT_FOUND      -> 404
//   - PROCESSING   / UNSUPPORTED_STATUS     -> 400
//   - UNKNOWN      / UNKNOWN_ERROR           -> 500

function mapPipelineResultToStatus(result: PaymentWebhookPipelineResult): number {
  if (result.ok) {
    return 200;
  }

  if (result.stage === "VERIFICATION") {
    return result.error === "INVALID_SIGNATURE" ? 401 : 400;
  }

  if (result.stage === "TRANSLATION") {
    return 400;
  }

  if (result.stage === "PROCESSING") {
    return result.error === "PAYMENT_NOT_FOUND" ? 404 : 400;
  }

  return 500;
}

export async function POST(request: Request) {
  return withRequestTracing("webhooks.payments", async () => {
    const body = await request.text();
    const headers = Object.fromEntries(request.headers.entries());

    const result = await processPaymentWebhookRequest({ headers, body });

    return NextResponse.json(result, { status: mapPipelineResultToStatus(result) });
  });
}
