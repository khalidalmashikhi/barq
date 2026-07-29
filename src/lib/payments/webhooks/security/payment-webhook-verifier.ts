import "server-only";

// Payment Webhook Verifier Interface — Phase 2.19 (Payment Webhook
// Security Foundation). Mirrors this codebase's own established
// provider-abstraction shape exactly: payment-gateway-provider.ts
// (Phase 2.15) and payment-webhook-adapter.ts (Phase 2.18) each define
// an interface + request/result types + a single factory that selects
// an implementation by key. This is that same pattern applied to
// inbound webhook request authentication.
//
// SINGLE RESPONSIBILITY — AUTHENTICITY ONLY: a verifier's only job is
// proving a raw inbound request genuinely came from the provider it
// claims to be from, and handing back the request's payload once that
// is established. It never reshapes the payload's fields (that is
// payment-webhook-adapter.ts's job, untouched by this phase) and never
// touches Payment/Booking state (that remains exclusively inside
// processPaymentWebhookEvent(), also untouched by this phase). No
// responsibility overlap, per this phase's own explicit requirement.
//
// SYNCHRONOUS BY DESIGN: real signature verification for the vendors
// this codebase already names (Stripe, PayPal, etc.) is a local HMAC/
// cryptographic comparison against an already-known secret — no network
// call is required at verification time. Matches this phase's own "No
// SDK. No REST." exclusions: a verifier needing network I/O to verify a
// signature would need exactly the SDK/REST call this phase forbids.
//
// RAW BODY, NOT PARSED JSON: `body` is the exact bytes/string the
// provider sent, before any parsing — real signature schemes (Stripe's
// included) sign over the raw, unparsed request body; verifying against
// an already-parsed-and-reserialized object can silently fail to catch
// a tampered payload. Parsing happens only after verification succeeds
// (see PaymentWebhookVerificationResult.payload below).
//
// REPLAY-PREPARATION, NOT REPLAY PROTECTION: `providerEventId` on a
// successful result is a reserved field a future replay-protection
// layer could key a duplicate-delivery check against — this phase adds
// the field and nothing else. No code anywhere reads, stores, or
// compares it; there is no de-duplication store, no time-window check,
// no "have I seen this event before" logic. That remains real,
// unstarted work for a future phase, exactly as this phase's own STOP
// section requires ("Do NOT implement replay protection").

export interface RawPaymentWebhookRequest {
  /// Lowercased header names, matching how this codebase already
  /// normalizes headers where relevant (see next.config.ts's own
  /// security-header handling) — a real signature header (e.g.
  /// Stripe-Signature) is read from here by a future real verifier.
  headers: Record<string, string>;
  /// The exact, unparsed request body — see this file's own comment for
  /// why raw bytes matter for signature verification specifically.
  body: string;
}

export type PaymentWebhookVerificationResult =
  | { ok: true; payload: unknown; providerEventId?: string }
  | { ok: false; error: "INVALID_SIGNATURE" | "MALFORMED_REQUEST" };

export interface PaymentWebhookVerifier {
  readonly key: string;
  verify(request: RawPaymentWebhookRequest): PaymentWebhookVerificationResult;
}
