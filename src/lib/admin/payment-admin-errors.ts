import "server-only";

// Payment admin action error codes — Phase 2.16 (Payment Capture
// Foundation). Same stable, locale-neutral, machine-readable convention
// as booking-admin-errors.ts/price-admin-errors.ts. PAYMENT_NOT_CAPTURABLE
// reuses payment-status-policy.ts's canCapturePayment() — an admin can
// only capture a Payment that is still INITIATED, the one state Capture
// is reachable from per DOMAIN_MODEL.md's "Initiated -> Captured -> ..."
// lifecycle.
//
// PAYMENT_NOT_REFUNDABLE — Phase 2.28 (Refund Orchestration): reuses
// payment-status-policy.ts's canRefundPayment() — an admin can only
// refund a Payment that is CAPTURED. Not merged into
// PAYMENT_NOT_CAPTURABLE: the two predicates test different statuses
// (INITIATED vs. CAPTURED) and a caller needs to distinguish which
// action failed and why, exactly like every other sibling *-errors.ts
// module's one-code-per-failure-reason convention.

export type PaymentAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_NOT_CAPTURABLE"
  | "PAYMENT_NOT_REFUNDABLE"
  | "UNKNOWN_ERROR";

const PAYMENT_ADMIN_ACTION_ERROR_CODES: readonly PaymentAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_NOT_CAPTURABLE",
  "PAYMENT_NOT_REFUNDABLE",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as every sibling
// *-errors.ts module: an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isPaymentAdminActionErrorCode(value: unknown): value is PaymentAdminActionErrorCode {
  return typeof value === "string" && (PAYMENT_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const PAYMENT_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "paymentErrorInvalidInput",
  NO_ADMIN_PROFILE: "paymentErrorNoAdminProfile",
  PAYMENT_NOT_FOUND: "paymentErrorNotFound",
  PAYMENT_NOT_CAPTURABLE: "paymentErrorNotCapturable",
  // No UI consumes this yet (Phase 2.28 explicitly excludes one) — the
  // key exists only to satisfy this mapping's Record<PaymentAdminActionErrorCode, string>
  // completeness, matching how every sibling *-errors.ts module already
  // requires one key per code regardless of whether a screen renders it
  // yet. Real message strings are added to messages/*/admin.json only
  // once a future phase's UI actually calls t("paymentErrorNotRefundable").
  PAYMENT_NOT_REFUNDABLE: "paymentErrorNotRefundable",
  UNKNOWN_ERROR: "paymentErrorUnknown",
} as const satisfies Record<PaymentAdminActionErrorCode, string>;

export function getPaymentAdminErrorTranslationKey(code: PaymentAdminActionErrorCode) {
  return PAYMENT_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
