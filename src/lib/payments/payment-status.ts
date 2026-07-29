import "server-only";
import type { PaymentStatus } from "@prisma/client";

// Payment status presentation — Payment Experience & Financial
// Operations phase. Mirrors src/lib/booking/booking-status.ts's exact
// shape (label-key map + style map, both typed against the real Prisma
// enum so a future new PaymentStatus value fails to compile here until
// updated).
//
// APPROVED PRESENTATION (do not collapse to Completed/Pending — see
// this phase's own approval): every one of the five PaymentStatus
// values gets its own distinct label and its own distinct badge style —
// INITIATED reads "Pending", CAPTURED reads "Paid", REFUNDED_PARTIAL
// and REFUNDED_FULL are never merged into one "Refunded" state, and
// FAILED always stays FAILED. Never group all non-CAPTURED statuses
// under "Pending".

type PaymentStatusLabelKey =
  | "paymentStatusInitiatedLabel"
  | "paymentStatusCapturedLabel"
  | "paymentStatusRefundedPartialLabel"
  | "paymentStatusRefundedFullLabel"
  | "paymentStatusFailedLabel";

const PAYMENT_STATUS_LABEL_KEYS: Record<PaymentStatus, PaymentStatusLabelKey> = {
  INITIATED: "paymentStatusInitiatedLabel",
  CAPTURED: "paymentStatusCapturedLabel",
  REFUNDED_PARTIAL: "paymentStatusRefundedPartialLabel",
  REFUNDED_FULL: "paymentStatusRefundedFullLabel",
  FAILED: "paymentStatusFailedLabel",
};

// One Badge variant per status — Badge only has 5 variants
// (default/success/warning/danger/info), which maps 1:1 onto the 5
// PaymentStatus values, so no two distinct statuses ever share a
// style. Badge text itself (never color alone) carries the meaning.
const PAYMENT_STATUS_BADGE_VARIANTS: Record<PaymentStatus, "default" | "success" | "warning" | "danger" | "info"> = {
  INITIATED: "warning",
  CAPTURED: "success",
  REFUNDED_PARTIAL: "info",
  REFUNDED_FULL: "default",
  FAILED: "danger",
};

export function getPaymentStatusLabel(status: string, t: (key: PaymentStatusLabelKey) => string): string {
  const key = PAYMENT_STATUS_LABEL_KEYS[status as PaymentStatus];
  return key ? t(key) : status;
}

export function getPaymentStatusBadgeVariant(status: string): "default" | "success" | "warning" | "danger" | "info" {
  return PAYMENT_STATUS_BADGE_VARIANTS[status as PaymentStatus] ?? "default";
}
