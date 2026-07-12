import "server-only";
import type { BookingStatus } from "@prisma/client";

// Booking status presentation — Engineering Sprint (Stabilization:
// deduplicate booking status labels/styles).
//
// Single source of truth for the Arabic label and badge styling of
// each BookingStatus value — previously defined independently, with
// identical wording/colors, in bookings/page.tsx and
// recent-bookings.tsx, per PROJECT_RULES.md §22. bookings/[id]/page.tsx
// duplicated only the label map (it never used a style map — that
// screen shows status as plain text, not a colored badge — a real,
// intentional visual difference preserved exactly by only consuming
// getBookingStatusLabel() there, never getBookingStatusStyle()).
//
// TYPING: the internal maps are keyed by the real, generated
// BookingStatus enum (type-only import — erased before bundling, so
// this carries no client/server bundling risk regardless of consumer)
// so TypeScript enforces both maps stay exhaustive against the actual
// schema — a future 7th BookingStatus value would fail to compile here
// until both maps are updated, catching drift no plain `Record<string,
// string>` could. The exported functions still accept a plain
// `string`, matching every current caller's existing DTO typing
// (MyBookingListItem.status, BookingDetail.status,
// DashboardBookingSummary.status are all `string`, not the Prisma
// enum) — narrowing those DTOs to BookingStatus is a separate,
// out-of-scope decision, not made here. An unrecognized value falls
// back exactly as every prior copy did: the raw status string for the
// label, a neutral badge class for the style.

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  CREATED: "قيد الانتظار",
  CONFIRMED: "مؤكد",
  IN_PROGRESS: "جارٍ",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
  DISPUTED: "قيد المراجعة",
};

const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  CREATED: "bg-accent/20 text-accent-foreground",
  CONFIRMED: "bg-success/10 text-success",
  IN_PROGRESS: "bg-secondary/15 text-secondary",
  COMPLETED: "bg-primary/10 text-primary",
  CANCELLED: "bg-danger/10 text-danger",
  DISPUTED: "bg-danger/10 text-danger",
};

const FALLBACK_STYLE = "bg-accent/20 text-accent-foreground";

export function getBookingStatusLabel(status: string): string {
  return BOOKING_STATUS_LABELS[status as BookingStatus] ?? status;
}

export function getBookingStatusStyle(status: string): string {
  return BOOKING_STATUS_STYLES[status as BookingStatus] ?? FALLBACK_STYLE;
}
