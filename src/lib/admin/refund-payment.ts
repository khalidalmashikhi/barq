"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { canRefundPayment } from "@/lib/payments/payment-status-policy";
import { getPaymentGatewayProvider } from "@/lib/payments/gateway/get-payment-gateway-provider";
import { PaymentGatewayPendingError } from "@/lib/payments/gateway/payment-gateway-provider";
import type { PaymentAdminActionErrorCode } from "./payment-admin-errors";

// Refund Payment (admin-initiated) — Phase 2.28 (Refund Orchestration),
// completed in Phase 2.29 (Refund Transaction). Mirrors
// capture-payment.ts's exact shape: "use server", UUID validation,
// requireAdmin() with the same UnauthenticatedError/ForbiddenError
// handling, fetch-and-validate via a named policy predicate
// (canRefundPayment), gateway call OUTSIDE the transaction, mutate +
// audit INSIDE one transaction, generic UNKNOWN_ERROR on anything
// unexpected — the same five-part shape capture-payment.ts has used
// since Phase 2.16.
//
// AMOUNT PARAMETER — Phase 2.29 added the second, optional `amount`
// parameter Phase 2.28 deliberately left out ("smallest orchestration
// required" at the time). Omitted: refund the entire Payment.amount
// (a full refund). A Decimal string: refund exactly that much (a
// partial refund) — validated below against Payment.amount using
// Prisma's own Decimal (decimal.js) arithmetic, never floating-point
// Number math, matching this codebase's established money-safety
// discipline (see stripe-payment-gateway-provider.ts's own
// toStripeMinorUnits() comment for the precedent this follows).
//
// SINGLE-SHOT REFUND: canRefundPayment(status) only allows CAPTURED —
// unchanged since Phase 2.28, not revisited here — so a Payment can
// only ever pass through this function once: after any refund
// (partial or full) it becomes REFUNDED_PARTIAL or REFUNDED_FULL,
// neither of which is CAPTURED, so a second refund attempt is rejected
// by the same eligibility check before ever reaching the gateway. This
// means Payment.refundAmount is always null/absent at the point this
// function reads it — there is no accumulating-multiple-partial-refunds
// case to reconcile, and the "is this a full or partial refund"
// question reduces to a single comparison against Payment.amount
// itself, not a running total. A future phase that wants to allow
// multiple successive partial refunds on the same Payment would need to
// revisit canRefundPayment() and this file's amount math together — not
// attempted here.
//
// STATUS DETERMINATION: unlike capture-payment.ts (which persists
// gatewayResult.status verbatim — capture is always all-or-nothing so
// there is nothing to compute), refund has a genuine "was 100% of the
// money actually returned" question capture never has. This file
// computes the persisted status itself, from the same validated amount
// used to build the gateway request — this is the single source of
// truth for what gets written, not a second, independent recomputation
// of what the gateway already decided: stripePaymentGatewayProvider.
// refund() derives its own returned status from this exact same signal
// (was `amount` present in the request), so the two are guaranteed to
// agree.
//
// FULL-AMOUNT NORMALIZATION — Phase 2.29A (Refund Transaction
// Remediation) fixed a real bug: Phase 2.29 only treated an OMITTED
// amount as "full" — a caller-supplied amount that happened to equal
// payment.amount exactly was still sent to the gateway as a partial
// request and persisted as REFUNDED_PARTIAL, misrepresenting a 100%
// refund as partial. isFullRefund below is now true whenever amount is
// omitted OR the validated amount equals payment.amount (Decimal
// equality, not floating-point), and that single boolean is what both
// this file's persisted status AND the gateway request's `amount`
// field (present only when NOT full) are derived from — the gateway
// never sees a request shaped as "partial" for what is actually a full
// refund, so its own REFUNDED_FULL/REFUNDED_PARTIAL determination
// always agrees with this file's.
//
// TRANSACTION BOUNDARY: getPaymentGatewayProvider().refund() is called
// OUTSIDE prisma.$transaction, identically to capture-payment.ts and
// accept-booking.ts — a real provider's refund() performs network I/O,
// which must never happen inside an open database transaction.
//
// CONCURRENT-REFUND SAFETY: the finalizing write is an atomic
// conditional tx.payment.updateMany({where: {id, status: "CAPTURED"}})
// — the exact same guard-and-check-count pattern Phase 2.25 introduced
// for capturePayment(), for the identical reason: two concurrent
// refundPayment() calls for the same Payment could otherwise both pass
// the initial canRefundPayment() read-then-act check before either
// commits. If the guarded update affects 0 rows, another request already
// refunded this Payment between this call's read and its write — this
// returns the existing PAYMENT_NOT_REFUNDABLE error (the same code the
// initial eligibility check already uses for "not CAPTURED"), not a new
// one, and records no audit event for a state change this call didn't
// actually make.
//
// SAME-PAYMENT CONCURRENT REFUNDS WITH DIFFERENT AMOUNTS — Phase 2.29A
// fixed a second, more serious gap: the local updateMany guard above
// only protects THIS codebase's own database — it cannot stop two
// concurrent refundPayment() calls from both reaching Stripe before
// either transaction commits. Phase 2.29's idempotency key included the
// requested amount, so two concurrent calls with two DIFFERENT amounts
// would carry two DIFFERENT keys and could both execute as genuinely
// separate refunds at Stripe, regardless of what the local guard later
// decided. stripePaymentGatewayProvider.refund() now keys on
// providerReference ALONE (see that file's own "REFUND KEY" comment),
// so two concurrent requests against the same PaymentIntent — whatever
// amount each requests — always collide on Stripe's own idempotency
// boundary: the second one either receives the first's cached response
// (identical parameters) or a hard Stripe error (different parameters,
// e.g. a different amount) — never a second, independent refund.
//
// PENDING/ASYNCHRONOUS OUTCOMES — Phase 2.29A: Stripe's real refund.status
// can be "pending" or "requires_action" — accepted but not yet
// confirmed, possibly resolving to success later via a mechanism
// (Stripe's own refund/charge.refund.updated webhook) explicitly out of
// this codebase's scope. Treating that the same as an ordinary failure
// would both risk eventually double-refunding (a future retry reusing
// the same providerReference-only idempotency key is actually safe
// against that specific risk — Stripe itself would just return the same
// pending/eventual result) AND leave a real, possibly-successful
// external operation completely untracked in this database if nobody
// ever retries. stripePaymentGatewayProvider.refund() throws the
// provider-agnostic PaymentGatewayPendingError (defined in
// payment-gateway-provider.ts, not Stripe-specific) for exactly these
// two statuses; this file catches that ONE type specially, records an
// audit event documenting that a refund was submitted and is still
// unconfirmed (reusing the existing AuditLog infrastructure — no new
// Payment status, no new persistence table, no webhook), and then still
// returns the same UNKNOWN_ERROR as any other failure — this file never
// claims a refund succeeded that it cannot yet confirm. Payment.status
// and refundAmount are deliberately left untouched in this case (still
// truthfully CAPTURED) since nothing is actually confirmed yet; a
// genuinely complete resolution of a pending refund requires either a
// new state or webhook-based reconciliation, both out of this phase's
// approved scope — see the phase report's own "Remaining risks" for
// why this is a deliberate, disclosed limitation, not an oversight.
//
// AUDIT: recordAuditEvent(), the same existing infrastructure
// capture-payment.ts already uses — no second/parallel audit mechanism.
// The pending-outcome audit write above is deliberately NOT inside
// prisma.$transaction: there is no Payment mutation to combine it with
// in that case (nothing is confirmed yet), so recordAuditEvent() is
// called with the plain `prisma` client directly — a usage its own
// DbClient type explicitly supports.
//
// DOMAIN OWNERSHIP: same standalone Payment-domain admin action
// reasoning as capture-payment.ts — not wired into any Booking-lifecycle
// transition, no notification, no ledger, no wallet, no accounting.

export type RefundPaymentResult = { ok: true } | { ok: false; error: PaymentAdminActionErrorCode };

export async function refundPayment(paymentId: string, amount?: string): Promise<RefundPaymentResult> {
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

    if (!canRefundPayment(payment.status)) {
      return { ok: false, error: "PAYMENT_NOT_REFUNDABLE" };
    }

    // Validate the caller-supplied partial amount, if any, using
    // Decimal (decimal.js) arithmetic — never Number/floating-point —
    // against the Payment's own original amount. See this file's own
    // "AMOUNT PARAMETER" comment.
    let refundAmountDecimal: Prisma.Decimal | undefined;
    if (amount !== undefined) {
      let parsed: Prisma.Decimal;
      try {
        parsed = new Prisma.Decimal(amount);
      } catch {
        return { ok: false, error: "INVALID_INPUT" };
      }
      if (!parsed.isFinite() || parsed.lte(0) || parsed.gt(payment.amount)) {
        return { ok: false, error: "INVALID_INPUT" };
      }
      refundAmountDecimal = parsed;
    }

    // FULL-AMOUNT NORMALIZATION — see this file's own module comment.
    // A caller-supplied amount equal to payment.amount is a full
    // refund, not a partial one, regardless of whether it was omitted
    // or explicitly provided.
    const isFullRefund = refundAmountDecimal === undefined || refundAmountDecimal.equals(payment.amount);
    const resolvedRefundAmount = refundAmountDecimal ?? payment.amount;

    let gatewayResult;
    try {
      // Called before the transaction starts — see this file's own
      // module comment for why a gateway call must never happen inside
      // one.
      gatewayResult = await getPaymentGatewayProvider().refund({
        providerReference: payment.providerReference ?? undefined,
        amount: isFullRefund ? undefined : resolvedRefundAmount.toFixed(2),
      });
    } catch (error) {
      if (error instanceof PaymentGatewayPendingError) {
        // See this file's own "PENDING/ASYNCHRONOUS OUTCOMES" comment —
        // record that a refund was submitted and is unconfirmed, then
        // fall through to the same UNKNOWN_ERROR the outer catch below
        // returns for every other unexpected failure.
        await recordAuditEvent(
          {
            actorType: "ADMIN",
            actorId: admin.id,
            action: "payment.refund_pending",
            entityType: "Payment",
            entityId: paymentId,
            previousValue: { status: payment.status },
            newValue: { status: payment.status, unconfirmedRefundAmount: resolvedRefundAmount.toFixed(2) },
          },
          prisma
        );
      }
      throw error;
    }

    const refundedElsewhere = await prisma.$transaction(async (tx) => {
      // Atomic conditional UPDATE — see this file's own module comment
      // ("CONCURRENT-REFUND SAFETY") for why this must be updateMany()
      // guarded by status: "CAPTURED" rather than a plain update().
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: "CAPTURED" },
        data: {
          status: gatewayResult.status,
          refundAmount: resolvedRefundAmount,
        },
      });

      if (count === 0) {
        return true;
      }

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "payment.refunded",
          entityType: "Payment",
          entityId: paymentId,
          previousValue: { status: payment.status, refundAmount: null },
          newValue: { status: gatewayResult.status, refundAmount: resolvedRefundAmount.toFixed(2) },
        },
        tx
      );

      return false;
    });

    if (refundedElsewhere) {
      return { ok: false, error: "PAYMENT_NOT_REFUNDABLE" };
    }

    return { ok: true };
  } catch (error) {
    // Includes stripePaymentGatewayProvider.refund()'s expected throw
    // for a non-"succeeded" Stripe response (see that file's own
    // "FAILURE" comment for why this must throw rather than return a
    // FAILED result — the Payment must remain CAPTURED, never flip to
    // the generic FAILED state reserved for a failed capture) and the
    // No-Op provider's own "not implemented" throw — never exposed to
    // the client; logged server-side only, matching
    // capture-payment.ts/deactivate-price.ts/accept-booking.ts.
    logger.error("refundPayment.unexpected_error", {
      paymentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
