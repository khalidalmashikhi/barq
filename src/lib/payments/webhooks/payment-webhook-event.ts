import "server-only";
import type { PaymentStatus } from "@prisma/client";
import { isValidUuid } from "@/lib/uuid";

// Canonical Payment Webhook Event — Phase 2.17 (Payment Webhook
// Foundation). The one shape every future provider adapter (Stripe,
// PayPal, OmanNet, etc.) must translate its own payload into before it
// ever reaches Payment-domain logic — mirrors payment-gateway-provider.ts's
// own "reuse PaymentStatus, never invent a parallel status vocabulary"
// discipline (see that module's own comment), applied to the inbound
// direction instead of the outbound gateway-call direction.
//
// LOOKUP KEY: bookingId, not a stored provider reference. Payment has no
// providerReference column — deliberately not added (see Phase 2.16's
// "No Prisma changes unless objectively required," restated as a hard
// constraint again in this phase) — and Payment.bookingId is already
// @unique and already the real lookup key complete-booking.ts uses
// today (`tx.payment.findUnique({ where: { bookingId } })`). A future
// real adapter is responsible for mapping its own provider-specific
// payment/session ID back to a bookingId — that mapping is
// provider-specific translation logic, out of this phase's scope.
//
// RUNTIME VALIDATION: PaymentStatus is never imported as a runtime
// value anywhere in this codebase — every existing usage
// (payment-gateway-provider.ts, payment-status-policy.ts,
// get-payments.ts) is `import type` only. This file follows that same
// convention: an incoming status string is validated against an
// explicit literal list, the same shape every `is{X}ErrorCode` runtime
// guard in this codebase already uses (booking-admin-errors.ts,
// price-admin-errors.ts, etc.) — not by importing the enum as a value.

export interface PaymentWebhookEvent {
  /// Which gateway produced this event — same key vocabulary as
  /// PaymentGatewayProvider.key (e.g. "NONE", a future "STRIPE").
  providerKey: string;
  /// The provider's own event identifier, carried through unchanged so
  /// a future dispatcher can detect a redelivered event before it ever
  /// reaches this canonical shape. Not interpreted by this module.
  providerEventId: string;
  bookingId: string;
  status: PaymentStatus;
  occurredAt: Date;
}

const PAYMENT_STATUS_VALUES = ["INITIATED", "CAPTURED", "REFUNDED_PARTIAL", "REFUNDED_FULL", "FAILED"] as const;

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUS_VALUES as readonly string[]).includes(value);
}

export function isPaymentWebhookEvent(value: unknown): value is PaymentWebhookEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.providerKey === "string" &&
    candidate.providerKey.length > 0 &&
    typeof candidate.providerEventId === "string" &&
    candidate.providerEventId.length > 0 &&
    typeof candidate.bookingId === "string" &&
    isValidUuid(candidate.bookingId) &&
    isPaymentStatus(candidate.status) &&
    candidate.occurredAt instanceof Date &&
    !Number.isNaN(candidate.occurredAt.getTime())
  );
}
