"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { canCapturePayment } from "@/lib/payments/payment-status-policy";
import { getPaymentGatewayProvider } from "@/lib/payments/gateway/get-payment-gateway-provider";
import type { PaymentAdminActionErrorCode } from "./payment-admin-errors";

// Capture Payment (admin-initiated) — Phase 2.16 (Payment Capture
// Foundation). Completes the Capture domain the gateway abstraction
// introduced in Phase 2.15/2.15A was built for: this is the first (and,
// per this phase's own scope, only) caller of
// PaymentGatewayProvider.capture(). Mirrors deactivate-price.ts's exact
// shape: "use server", UUID validation, requireAdmin() with the same
// UnauthenticatedError/ForbiddenError handling, fetch-and-validate via a
// named policy predicate (canCapturePayment — see that module's own
// comment for why this stays a plain predicate rather than a generic
// transition matrix), mutate + audit inside one transaction, generic
// UNKNOWN_ERROR on anything unexpected.
//
// DOMAIN OWNERSHIP: this is deliberately a standalone Payment-domain
// admin action, not a step wired into any Booking-lifecycle transition.
// DOMAIN_MODEL.md's Booking context explicitly lists "payment capture"
// under what Booking "Does Not Own" — capture belongs to the Payment
// entity's own lifecycle ("Initiated -> Captured -> ..."), which today
// advances independently of Booking's own CONFIRMED/IN_PROGRESS/
// COMPLETED states. Any Payment currently INITIATED is a valid capture
// candidate regardless of its Booking's current status.
//
// FILE LOCATION — Phase 2.16A (Payment Capture Domain Refactor):
// canCapturePayment() moved to src/lib/payments/payment-status-policy.ts
// (the entity's own business rule), but this orchestration function
// (auth, fetch-and-validate, transaction, audit) deliberately stays
// here in src/lib/admin/. That split is not a compromise — it is the
// one and only pattern this codebase already uses everywhere a
// caller-specific action consumes a domain's pure predicate:
// src/lib/admin/cancel-booking.ts imports canCancelBooking from
// @/lib/booking/cancellation-policy while its own "use server" auth/tx/
// audit orchestration stays in src/lib/admin/, exactly like this file.
// There is no precedent anywhere in this codebase (Price, Service,
// Availability, Provider, or Booking's own admin variants) for an
// admin-invoked mutation's full auth+transaction+audit orchestration
// living outside src/lib/admin/ — only the reusable business-rule
// predicate moves to the entity's domain folder.
//
// TRANSACTION BOUNDARY: getPaymentGatewayProvider().capture() is called
// OUTSIDE prisma.$transaction, mirroring accept-booking.ts's identical
// placement of initiate() (Phase 2.15A) — a real provider's capture()
// may perform network I/O, which must never happen inside an open
// database transaction.
//
// RUNTIME WIRING — Phase 2.23 (Payment Gateway Runtime Wiring):
// getPaymentGatewayProvider() is now called with NO explicit key
// (previously hardcoded to "NONE"), so it resolves whichever gateway
// PAYMENT_PROVIDER selects (Phase 2.22A). With PAYMENT_PROVIDER unset
// (the default), this still always throws via the No-Op provider (see
// no-op-payment-gateway-provider.ts's own comment) — unchanged
// behavior.
//
// GAP CLOSED — Phase 2.24 (Provider Reference Persistence): the
// previous gap this file's own comment used to document — Payment
// having no stored providerReference, so real Stripe capture() could
// never succeed — is now closed. accept-booking.ts persists
// paymentInitiation.providerReference onto the Payment row at creation
// time; this call now reads it back and passes it through. A Payment
// created under PAYMENT_PROVIDER=NONE (or before this phase) still has
// providerReference: null, so capturing it against a real gateway
// still correctly fails with the same generic UNKNOWN_ERROR — that is
// now the objectively correct outcome (you cannot capture, via Stripe,
// a Payment that was never actually initiated via Stripe), not a gap.
//
// DUPLICATE-CAPTURE SAFETY — Phase 2.25 (Payment Idempotency & Capture
// Safety): the initial canCapturePayment(payment.status) check above is
// a plain read-then-act check — like create-booking.ts's own
// pre-Entry-067 capacity check, two concurrent capturePayment() calls
// for the same Payment (a double-click, a retried request, two admins)
// could both read status: INITIATED and both pass it before either one
// commits. The finalizing write below is therefore an atomic
// conditional UPDATE — tx.payment.updateMany() guarded by
// `status: "INITIATED"` in its own WHERE clause, mirroring
// create-booking.ts's own atomic-conditional-UPDATE strategy exactly
// (see that file's own "CONCURRENCY STRATEGY" comment), just expressed
// through Prisma's normal query builder instead of raw SQL, since this
// guard is a simple equality check, not a computed comparison between
// columns. If the update affects 0 rows, another request already
// captured (or otherwise transitioned) this Payment between our read
// and this write — a genuine race, correctly caught, not a bug — and
// this call returns the existing PAYMENT_NOT_CAPTURABLE error rather
// than recording a second, duplicate audit event for a state change
// that didn't actually happen here. No new Payment status was
// introduced to express this.
//
// AUDIT: recordAuditEvent(), not a new/second financial audit trail —
// Payment has no BookingStatusEvent-equivalent history table of its own,
// and record-audit-event.ts's own comment reserves BookingStatusEvent
// exclusively for Booking status changes. This is an admin-domain
// mutation on Payment, the same category as price.deactivated/
// availability.* actions already recorded this same way.

export type CapturePaymentResult = { ok: true } | { ok: false; error: PaymentAdminActionErrorCode };

export async function capturePayment(paymentId: string): Promise<CapturePaymentResult> {
  if (!isValidUuid(paymentId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_ADMIN_PROFILE" };
    }
    throw error;
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      return { ok: false, error: "PAYMENT_NOT_FOUND" };
    }

    if (!canCapturePayment(payment.status)) {
      return { ok: false, error: "PAYMENT_NOT_CAPTURABLE" };
    }

    // Called before the transaction starts — see this file's own module
    // comment for why a gateway call must never happen inside one.
    const gatewayResult = await getPaymentGatewayProvider().capture({
      providerReference: payment.providerReference ?? undefined,
    });

    const capturedElsewhere = await prisma.$transaction(async (tx) => {
      // Atomic conditional UPDATE — see this file's own module comment
      // ("DUPLICATE-CAPTURE SAFETY") for why this must be updateMany()
      // guarded by status: "INITIATED" rather than a plain update().
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: "INITIATED" },
        data: {
          status: gatewayResult.status,
          capturedAt: gatewayResult.status === "CAPTURED" ? gatewayResult.occurredAt : null,
        },
      });

      if (count === 0) {
        return true;
      }

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "payment.captured",
          entityType: "Payment",
          entityId: paymentId,
          previousValue: { status: payment.status },
          newValue: { status: gatewayResult.status },
        },
        tx
      );

      return false;
    });

    if (capturedElsewhere) {
      return { ok: false, error: "PAYMENT_NOT_CAPTURABLE" };
    }

    return { ok: true };
  } catch (error) {
    // Includes the No-Op provider's expected capture() throw (no real
    // gateway configured) and, with PAYMENT_PROVIDER=STRIPE, any real
    // Stripe API failure (including the expected "providerReference is
    // required" throw for a Payment with none stored — see this file's
    // own module comment) — never exposed to the client; logged
    // server-side only, matching deactivate-price.ts/accept-booking.ts.
    logger.error("capturePayment.unexpected_error", {
      paymentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
