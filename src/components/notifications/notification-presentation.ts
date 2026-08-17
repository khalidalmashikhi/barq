import type { LucideIcon } from "lucide-react";
import { CalendarPlus, CalendarCheck, XCircle, XOctagon, Clock, Star, Bell, BadgeCheck, Send, FileUp, FileX2, AlertTriangle } from "lucide-react";
import type { BadgeVariant } from "@/components/ui/badge";

// Notification presentation consolidation — Provider Notifications &
// Operational Alerts phase.
//
// WHY THIS LIVES HERE, NOT IN src/lib/notifications/: it references
// React component values (lucide-react icons), so it belongs in the
// UI/component layer, not alongside the domain query modules in
// src/lib/notifications/ (get-notifications.ts etc.) — the same
// domain/presentation split already used elsewhere in this codebase
// (e.g. src/lib/booking/booking-status.ts returns plain label/variant
// data; the Badge that renders it lives under src/components/).
//
// REPLACES the previous binary rule duplicated across three call sites
// (`item.causingBookingId ? CalendarCheck : Bell` in both the Provider
// and Customer notifications pages, and no icon logic at all in
// NotificationBell) with one real per-kind mapping, keyed by the same
// BookingNotificationKind string values notify.ts already writes into
// each row's own content.kind (see that file's own comment — no Prisma
// schema change, the kind lives inside the existing Json column).
//
// BACKWARD COMPATIBILITY, DELIBERATE: rows written before this phase
// (or by src/lib/contracts/execution/notify.ts, a separate module this
// phase does not touch) have no `kind` at all. getNotificationPresentation
// treats a missing or unrecognized kind as a normal, expected case —
// never throws, never guesses a specific event from it — and returns
// GENERIC_FALLBACK, the same neutral bell/default badge every such row
// has always effectively shown.

export type NotificationCategoryKey =
  | "categoryNew"
  | "categoryConfirmed"
  | "categoryRejected"
  | "categoryCancelled"
  | "categoryExpired"
  | "categoryReview"
  | "categoryApproved"
  | "categoryGeneral"
  // Gate B3 — provider-verification event categories.
  | "categorySubmitted"
  | "categoryDocument"
  | "categoryChanges";

export type NotificationPresentation = {
  Icon: LucideIcon;
  badgeVariant: BadgeVariant;
  categoryKey: NotificationCategoryKey;
};

const GENERIC_FALLBACK: NotificationPresentation = {
  Icon: Bell,
  badgeVariant: "default",
  categoryKey: "categoryGeneral",
};

const PRESENTATION_BY_KIND: Record<string, NotificationPresentation> = {
  PENDING_PROVIDER: { Icon: CalendarPlus, badgeVariant: "info", categoryKey: "categoryNew" },
  BOOKING_ACCEPTED: { Icon: CalendarCheck, badgeVariant: "success", categoryKey: "categoryConfirmed" },
  PROVIDER_BOOKING_CONFIRMED: { Icon: CalendarCheck, badgeVariant: "success", categoryKey: "categoryConfirmed" },
  BOOKING_REJECTED: { Icon: XCircle, badgeVariant: "danger", categoryKey: "categoryRejected" },
  PROVIDER_BOOKING_REJECTED: { Icon: XCircle, badgeVariant: "default", categoryKey: "categoryRejected" },
  BOOKING_CANCELLED: { Icon: XOctagon, badgeVariant: "warning", categoryKey: "categoryCancelled" },
  BOOKING_CANCELLED_BY_CUSTOMER: { Icon: XOctagon, badgeVariant: "warning", categoryKey: "categoryCancelled" },
  BOOKING_EXPIRED: { Icon: Clock, badgeVariant: "warning", categoryKey: "categoryExpired" },
  NEW_REVIEW_RECEIVED: { Icon: Star, badgeVariant: "success", categoryKey: "categoryReview" },
  // Customer → Provider Journey (C) — provider application approved.
  PROVIDER_APPROVED: { Icon: BadgeCheck, badgeVariant: "success", categoryKey: "categoryApproved" },
  // Provider Review / Reject / Resubmit — application rejected (resubmittable).
  PROVIDER_REJECTED: { Icon: XCircle, badgeVariant: "default", categoryKey: "categoryRejected" },
  // Gate B2/B3 — provider-verification lifecycle events (kinds set by the B2
  // writers; keyed here for icon/category presentation).
  PROVIDER_VERIFICATION_SUBMITTED: { Icon: Send, badgeVariant: "info", categoryKey: "categorySubmitted" },
  PROVIDER_CHANGES_RESUBMITTED: { Icon: Send, badgeVariant: "info", categoryKey: "categorySubmitted" },
  PROVIDER_DOCUMENT_UPLOADED: { Icon: FileUp, badgeVariant: "info", categoryKey: "categoryDocument" },
  PROVIDER_DOCUMENT_REPLACED: { Icon: FileUp, badgeVariant: "info", categoryKey: "categoryDocument" },
  PROVIDER_CHANGES_REQUESTED: { Icon: AlertTriangle, badgeVariant: "warning", categoryKey: "categoryChanges" },
  PROVIDER_DOCUMENT_REJECTED: { Icon: FileX2, badgeVariant: "danger", categoryKey: "categoryRejected" },
};

export function getNotificationPresentation(kind: string | undefined): NotificationPresentation {
  if (!kind) return GENERIC_FALLBACK;
  return PRESENTATION_BY_KIND[kind] ?? GENERIC_FALLBACK;
}
