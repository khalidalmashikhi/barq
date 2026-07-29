import "server-only";
import type {
  PaymentGatewayProvider,
  PaymentGatewayInitiateRequest,
  PaymentGatewayCaptureRequest,
  PaymentGatewayRefundRequest,
  PaymentGatewayResult,
} from "../payment-gateway-provider";

// No-Op Payment Gateway Provider — Phase 2.15 (Payment Gateway
// Abstraction Foundation). Unlike src/lib/otp/providers/console-provider.ts
// (genuinely delivers an OTP to the terminal — a safe, real action) or
// signature-providers/internal-signature-provider.ts (genuinely records
// in-app consent — also a safe, real action), Payments has no equivalent
// safe-but-real default: any claimed CAPTURED/REFUNDED_* outcome would
// misrepresent that real money moved when none did. This phase's own
// explicit exclusions ("No Payment Capture implementation," "No Refund
// implementation") mean this provider must not pretend to do either.
//
// initiate() is the one method that can be honestly satisfied without a
// real gateway: it reports back exactly the same INITIATED status
// Booking's own accept-booking.ts already assigns when it creates a
// Payment row directly today — this provider adds no new claim, it just
// echoes the one true statement available before any gateway exists.
//
// capture() and refund() always throw — there is no honest no-op for
// either (a fabricated success would misstate real financial state; a
// fabricated FAILED would misstate that something was even attempted).
//
// Phase 2.27 (Refund Foundation) confirmed refund()'s request shape
// (PaymentGatewayRefundRequest.amount became optional — see that
// interface's own comment) required no change here: this provider never
// inspects `request` at all, full- or partial-refund-shaped alike.

export const noOpPaymentGatewayProvider: PaymentGatewayProvider = {
  key: "NONE",

  async initiate(request: PaymentGatewayInitiateRequest): Promise<PaymentGatewayResult> {
    void request;
    return { status: "INITIATED", occurredAt: new Date() };
  },

  async capture(request: PaymentGatewayCaptureRequest): Promise<PaymentGatewayResult> {
    void request;
    throw new Error(
      "noOpPaymentGatewayProvider.capture: no real Payment Gateway is configured — Payment capture has not been implemented yet."
    );
  },

  async refund(request: PaymentGatewayRefundRequest): Promise<PaymentGatewayResult> {
    void request;
    throw new Error(
      "noOpPaymentGatewayProvider.refund: no real Payment Gateway is configured — Payment refund has not been implemented yet."
    );
  },
};
