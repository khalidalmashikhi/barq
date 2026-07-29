import "server-only";
import type { BookingStatus } from "@prisma/client";

// Booking status presentation — Engineering Sprint (Stabilization:
// deduplicate booking status labels/styles), LOCALIZED Phase 5.1
// (Production Readiness).
//
// Single source of truth for the label and badge styling of each
// BookingStatus value — previously defined independently, with
// identical wording/colors, in bookings/page.tsx and
// recent-bookings.tsx, per PROJECT_RULES.md §22. bookings/[id]/page.tsx
// duplicated only the label map (it never used a style map — that
// screen shows status as plain text, not a colored badge — a real,
// intentional visual difference preserved exactly by only consuming
// getBookingStatusLabel() there, never getBookingStatusStyle()).
//
// PHASE 5.1 FIX: this file previously hardcoded Arabic-only label
// strings, bypassing the message catalog entirely — every non-Arabic
// user saw Arabic status badges on their own bookings, a launch-
// blocking bug the Phase 5 audit flagged. getBookingStatusLabel() now
// takes the caller's own translator (every one of its 8 call sites is
// an async Server Component that already resolves a "booking"-
// namespace translator a few lines above the call) and resolves a
// translation key, never a hardcoded string, directly. getBookingStatus
// Style() is unchanged — pure Tailwind class lookup, no locale
// dependency.
//
// TYPING: the internal maps are keyed by the real, generated
// BookingStatus enum (type-only import — erased before bundling, so
// this carries no client/server bundling risk regardless of consumer)
// so TypeScript enforces both maps stay exhaustive against the actual
// schema — a future new BookingStatus value would fail to compile here
// until both maps are updated, catching drift no plain `Record<string,
// string>` could. The exported functions still accept a plain
// `string`, matching every current caller's existing DTO typing
// (MyBookingListItem.status, BookingDetail.status,
// DashboardBookingSummary.status are all `string`, not the Prisma
// enum) — narrowing those DTOs to BookingStatus is a separate,
// out-of-scope decision, not made here. An unrecognized status value
// falls back exactly as every prior copy did: the raw status string
// for the label, a neutral badge class for the style.

// A literal union (not plain `string`) so that a next-intl Translator
// scoped to the "booking" namespace — whose call signature accepts
// only its own known key literals, not arbitrary strings — is still
// assignable as the `t` parameter below: a function accepting a wider
// key type is assignable where a narrower one is expected, but not the
// reverse, so this union must stay narrow and exact.
type BookingStatusLabelKey =
  | "statusCreated"
  | "statusPendingProvider"
  | "statusConfirmed"
  | "statusInProgress"
  | "statusCompleted"
  | "statusCancelled"
  | "statusRejected"
  | "statusDisputed"
  | "statusExpired";

const BOOKING_STATUS_LABEL_KEYS: Record<BookingStatus, BookingStatusLabelKey> = {
  CREATED: "statusCreated",
  PENDING_PROVIDER: "statusPendingProvider",
  CONFIRMED: "statusConfirmed",
  IN_PROGRESS: "statusInProgress",
  COMPLETED: "statusCompleted",
  CANCELLED: "statusCancelled",
  REJECTED: "statusRejected",
  DISPUTED: "statusDisputed",
  EXPIRED: "statusExpired",
};

const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  CREATED: "bg-accent/20 text-accent-foreground",
  PENDING_PROVIDER: "bg-accent/20 text-accent-foreground",
  CONFIRMED: "bg-success/10 text-success",
  IN_PROGRESS: "bg-secondary/15 text-secondary",
  COMPLETED: "bg-primary/10 text-primary",
  CANCELLED: "bg-danger/10 text-danger",
  REJECTED: "bg-danger/10 text-danger",
  DISPUTED: "bg-danger/10 text-danger",
  // System-driven timeout (Phase 5.1) — visually grouped with the
  // other negative/terminal outcomes, same as REJECTED/CANCELLED.
  EXPIRED: "bg-danger/10 text-danger",
};

const FALLBACK_STYLE = "bg-accent/20 text-accent-foreground";

export function getBookingStatusLabel(status: string, t: (key: BookingStatusLabelKey) => string): string {
  const key = BOOKING_STATUS_LABEL_KEYS[status as BookingStatus];
  return key ? t(key) : status;
}

export function getBookingStatusStyle(status: string): string {
  return BOOKING_STATUS_STYLES[status as BookingStatus] ?? FALLBACK_STYLE;
}
