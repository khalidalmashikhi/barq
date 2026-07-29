import "server-only";
import type { PaymentStatus } from "@prisma/client";

// Payment Gateway Provider Interface — Phase 2.15 (Payment Gateway
// Abstraction Foundation). Mirrors this codebase's own established
// provider-abstraction shape exactly: src/lib/otp/provider.ts (Phase
// D.4) and src/lib/contracts/execution/signature-providers/
// signature-provider.ts (Phase E.3) each define an interface + request/
// result types + a single factory that selects an implementation by
// key — no other file in either domain ever branches on a vendor name.
// This is that same pattern applied to Payments.
//
// "No provider-specific logic outside the provider layer": the Booking/
// Payment/Invoice domains never see Stripe, PayPal, OmanNet, or any
// other vendor name — they only ever see this interface. A future real
// gateway is a new PaymentGatewayProvider implementation selected by
// get-payment-gateway-provider.ts; no other file changes.
//
// STATUS REUSE: PaymentGatewayResult.status is literally Prisma's own
// PaymentStatus enum — not a redefined parallel type — per this phase's
// explicit "Reuse the existing PaymentStatus enum. Do not redesign."
// A provider's job is to report which of the five existing values a
// gateway operation resulted in; it never invents a sixth.
//
// NOT WIRED UP: nothing in src/lib/booking/ or src/lib/admin/ calls
// this interface yet (see this phase's own report for why: capture/
// refund have no safe way to be genuinely implemented without a real
// gateway, and wiring even a no-op call into accept-booking.ts/
// complete-booking.ts would be a runtime-behavior change this
// inspection-first phase must not make). This module exists standalone,
// fully tested, ready for a future phase to actually call.
//
// REFUND FOUNDATION — Phase 2.27 (Refund Foundation): capture() (Phase
// 2.16) is now fully wired end-to-end with runtime provider resolution,
// persisted providerReference, duplicate-capture safety, and gateway
// idempotency — refund() remains deliberately unwired and unimplemented
// (both providers still throw; see each one's own comment). This phase
// confirmed, by inspection, that refund() itself required NO interface
// redesign to be a complete foundation: PaymentStatus already has
// REFUNDED_PARTIAL/REFUNDED_FULL (no new state invented), and
// Payment.refundAmount already exists in the schema — only
// PaymentGatewayRefundRequest.amount's optionality changed (required ->
// optional) to make "full" vs "partial" refund two distinct,
// unambiguous request shapes. No orchestration action (a future
// refund-payment.ts, mirroring capture-payment.ts) and no admin-facing
// error codes exist yet — those belong to a future, separately-scoped
// phase, exactly as canCapturePayment/capture-payment.ts arrived only
// after this same gateway-only foundation existed for capture().

export interface PaymentGatewayInitiateRequest {
  bookingId: string;
  /// Decimal amount as a string, matching how this codebase already
  /// carries Decimal amounts across boundaries (e.g. Booking.
  /// priceSnapshotAmount.toString() in accept-booking.ts/complete-booking.ts).
  amount: string;
  currency: string;
}

export interface PaymentGatewayCaptureRequest {
  /// An opaque reference to the payment session/intent a provider's own
  /// initiate() call previously returned — undefined for a provider
  /// with no such concept.
  providerReference?: string;
}

export interface PaymentGatewayRefundRequest {
  providerReference?: string;
  /// Decimal amount as a string, or omitted entirely — Phase 2.27
  /// (Refund Foundation) makes "full refund" and "partial refund" two
  /// distinct, unambiguous request shapes rather than one field a
  /// caller must always populate correctly: undefined means refund the
  /// entire captured amount (the caller need not know or repeat that
  /// amount); a Decimal string means refund exactly that amount. Mirrors
  /// Stripe's own real Refund API convention (`amount` optional; omit
  /// for a full refund) — this codebase's own established practice of
  /// checking the installed SDK's real types before shaping a request.
  amount?: string;
}

export interface PaymentGatewayResult {
  status: PaymentStatus;
  /// An external reference ID from the provider (e.g. a future Stripe
  /// PaymentIntent id) — undefined for a provider with no such concept.
  providerReference?: string;
  occurredAt: Date;
}

export interface PaymentGatewayProvider {
  readonly key: string;
  initiate(request: PaymentGatewayInitiateRequest): Promise<PaymentGatewayResult>;
  capture(request: PaymentGatewayCaptureRequest): Promise<PaymentGatewayResult>;
  refund(request: PaymentGatewayRefundRequest): Promise<PaymentGatewayResult>;
}

// PaymentGatewayPendingError — Phase 2.29A (Refund Transaction
// Remediation). A provider-agnostic signal that a gateway operation was
// accepted but has not yet reached a final, confirmable outcome — e.g.
// Stripe's own refund.status can be "pending" or "requires_action" for
// payment methods that don't refund synchronously (the installed SDK's
// own Refunds.d.ts doc comment: "This can be pending, requires_action,
// succeeded, failed, or canceled"). This is deliberately NOT a sixth
// PaymentStatus value — inventing one was ruled out (see this file's
// own "STATUS REUSE" comment) — and deliberately NOT Stripe-specific:
// it lives here, in the neutral interface file every domain caller
// already imports, precisely so a caller (refund-payment.ts) can catch
// it by type without ever importing anything from a *-payment-gateway-
// provider.ts file, preserving gateway/provider isolation. A provider
// throws this instead of an ordinary Error specifically so the caller
// can choose to record that an operation is genuinely still in flight
// (not simply failed) without fabricating a success it cannot yet
// confirm — see refund-payment.ts's own comment for how it's used.
export class PaymentGatewayPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentGatewayPendingError";
  }
}
