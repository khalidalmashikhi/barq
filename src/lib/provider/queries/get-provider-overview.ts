import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { bookingMoneyViewFromRow, type BookingMoneyView } from "@/lib/booking/pricing/booking-money-view";

// Provider Overview query — Provider Dashboard Phase 1a.
//
// BOUNDED-CONTEXT STRUCTURE, DELIBERATE: lives under
// src/lib/provider/queries/ (not a flat src/lib/provider/*.ts), per
// explicit instruction — future Provider query modules
// (get-provider-services, get-provider-bookings,
// get-provider-availability, in later phases) should follow this same
// src/lib/provider/queries/ convention.
//
// AUTH TRUST MODEL (revised — Security Hardening pass): this function
// takes no arguments and resolves its own provider.id via
// requireProvider() internally — it no longer trusts a providerId
// supplied by its caller, closing off the possibility of a future
// caller accidentally (or maliciously) passing another provider's ID.
// This mirrors get-my-bookings.ts's self-resolving pattern instead of
// get-dashboard-data.ts's "caller resolves once, passes an ID down"
// pattern — a deliberate shift for this specific module, made because
// the query itself is now the sole, independent security boundary,
// not something delegated to whichever caller happens to invoke it.
// src/app/provider/page.tsx still calls requireProvider() itself too,
// but only for its own route-level 404/redirect handling and AppShell
// behavior — that call no longer feeds this function.
//
// SCOPE, PER APPROVED PHASE 1A DESIGN: 6 real counts + a short (max 5)
// recent-activity list. No tables, no editing, no payments — read-only
// counts and a passive display list only.
//
// "TODAY" — OMAN CALENDAR DAY, NOT SERVER-LOCAL TIME: Asia/Muscat
// observes no daylight saving time and is a fixed UTC+4 offset
// year-round, which makes a fixed-offset calculation exact for this
// specific timezone — this technique would NOT be safe to reuse for a
// timezone that observes DST. Implemented once, correctly, from the
// start (not a server-local `new Date()` approximation), per explicit
// instruction.

const OMAN_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

export function getOmanTodayRangeUtc(now: Date = new Date()): { start: Date; end: Date } {
  const omanShifted = new Date(now.getTime() + OMAN_UTC_OFFSET_MS);
  const omanYear = omanShifted.getUTCFullYear();
  const omanMonth = omanShifted.getUTCMonth();
  const omanDate = omanShifted.getUTCDate();

  // Midnight Oman time, expressed as the real UTC instant it
  // corresponds to (Oman midnight = that UTC calendar instant minus 4h).
  const start = new Date(Date.UTC(omanYear, omanMonth, omanDate, 0, 0, 0, 0) - OMAN_UTC_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}

export type ProviderRecentBookingItem = {
  id: string;
  serviceName: string;
  status: string;
  /// UNIT price snapshot (backward-compatible; unchanged meaning).
  priceSnapshot: string | null;
  /// BOOKING TOTAL PRESENTATION — authoritative money view; the provider home shows the effective
  /// booking total, not the unit price (§17).
  bookingMoney: BookingMoneyView;
  createdAt: Date;
};

/// Phase F.3 (Provider Dashboard redesign) — a real booking preview row
/// carrying its scheduled slot time, distinct from
/// ProviderRecentBookingItem (which is createdAt-ordered "activity",
/// not date-ordered "what's coming up"). Used for the new Today's
/// Bookings / Upcoming Bookings dashboard sections.
export type ProviderBookingPreviewItem = {
  id: string;
  serviceName: string;
  status: string;
  seats: number;
  /// UNIT price snapshot (backward-compatible; unchanged meaning).
  priceSnapshot: string | null;
  /// BOOKING TOTAL PRESENTATION — authoritative money view; the dashboard preview shows the
  /// effective booking total, not the unit price (§17).
  bookingMoney: BookingMoneyView;
  slotStartTime: Date;
};

/// Phase 4.2 (Provider Experience, Priority 4 — Dashboard) — a slot
/// that has reached its full capacity (bookedCount >= capacity) and is
/// still upcoming. "Fully booked" is a computed condition, never a
/// stored state (see AvailabilitySlotState's own schema comment) — this
/// list is the dashboard's only place that computes it, so a provider
/// can see demand outpacing supply and open more slots if they choose.
export type ProviderCapacityAlertItem = {
  id: string;
  serviceName: string;
  startTime: Date;
  capacity: number;
};

export type ProviderOverviewData = {
  publishedServicesCount: number;
  draftServicesCount: number;
  activeBookingsCount: number;
  /// Phase F.3 — narrower than activeBookingsCount (PENDING_PROVIDER/
  /// CONFIRMED/IN_PROGRESS): only bookings genuinely awaiting the
  /// provider's own confirm/reject decision (status PENDING_PROVIDER,
  /// updated in Phase 4.1 — CREATED is now a momentary status a booking
  /// is never actually found resting in). A real, distinct operational
  /// signal from "active", not a duplicate of it.
  pendingConfirmationsCount: number;
  todaysBookingsCount: number;
  upcomingBookingsCount: number;
  upcomingOpenSlotsCount: number;
  /// Phase F.3 — real rows (max 5), ordered by the slot's own start
  /// time (not createdAt), scoped to today's Oman calendar day.
  todaysBookings: ProviderBookingPreviewItem[];
  /// Phase F.3 — real rows (max 5), ordered by slot start time,
  /// starting after today's Oman calendar day ends (so this list and
  /// todaysBookings never show the same row twice).
  upcomingBookings: ProviderBookingPreviewItem[];
  recentActivity: ProviderRecentBookingItem[];
  /// Phase 4.2 — real rows (max 5), upcoming slots at full capacity,
  /// ordered by start time. Empty when nothing is currently sold out.
  capacityAlerts: ProviderCapacityAlertItem[];
  /// Provider Analytics & Business Insights — real rows (max 5),
  /// CANCELLED/REJECTED bookings only, newest first. recentActivity
  /// above already includes these mixed in with every other status
  /// (it has no status filter) — this is the same shape, scoped down,
  /// as its own dedicated parallel query in the same Promise.all below
  /// (not a second round-trip after the fact).
  recentlyCancelledBookings: ProviderRecentBookingItem[];
};

export async function getProviderOverview(): Promise<ProviderOverviewData> {
  const { provider } = await requireProvider();
  const providerId = provider.id;
  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";

  const now = new Date();
  const { start: todayStart, end: todayEnd } = getOmanTodayRangeUtc(now);

  const [
    publishedServicesCount,
    draftServicesCount,
    activeBookingsCount,
    pendingConfirmationsCount,
    todaysBookingsCount,
    upcomingBookingsCount,
    upcomingOpenSlotsCount,
    recentBookings,
    todaysBookingRows,
    upcomingBookingRows,
    upcomingOpenSlotRows,
    recentlyCancelledRows,
  ] = await Promise.all([
    prisma.service.count({ where: { providerId, status: "PUBLISHED" } }),
    prisma.service.count({ where: { providerId, status: "DRAFT" } }),
    // Broader than Customer dashboard's own "active" definition (which
    // excludes PENDING_PROVIDER) — for a Provider, a pending/unconfirmed
    // booking is very much active business needing attention.
    prisma.booking.count({
      where: { providerId, status: { in: ["PENDING_PROVIDER", "CONFIRMED", "IN_PROGRESS"] } },
    }),
    prisma.booking.count({ where: { providerId, status: "PENDING_PROVIDER" } }),
    // Scoped to bookings that reference a scheduled Availability slot
    // only — a booking with no slot has no meaningful "today," and is
    // honestly excluded here rather than folded in some other way.
    prisma.booking.count({
      where: {
        providerId,
        status: { not: "CANCELLED" },
        availability: { startTime: { gte: todayStart, lt: todayEnd } },
      },
    }),
    prisma.booking.count({
      where: {
        providerId,
        status: { not: "CANCELLED" },
        availability: { startTime: { gt: now } },
      },
    }),
    prisma.availability.count({
      where: { service: { providerId }, state: "OPEN", startTime: { gt: now } },
    }),
    prisma.booking.findMany({
      where: { providerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      include: { service: true },
    }),
    prisma.booking.findMany({
      where: {
        providerId,
        status: { not: "CANCELLED" },
        availability: { startTime: { gte: todayStart, lt: todayEnd } },
      },
      orderBy: { availability: { startTime: "asc" } },
      take: 5,
      include: { service: true, availability: true },
    }),
    prisma.booking.findMany({
      where: {
        providerId,
        status: { not: "CANCELLED" },
        availability: { startTime: { gte: todayEnd } },
      },
      orderBy: { availability: { startTime: "asc" } },
      take: 5,
      include: { service: true, availability: true },
    }),
    // "Fully booked" is a computed condition (bookedCount >= capacity),
    // never a stored state — see AvailabilitySlotState's own schema
    // comment — so this fetches upcoming OPEN slots and the filter
    // happens in JS below, not in this query itself.
    prisma.availability.findMany({
      where: { service: { providerId }, state: "OPEN", startTime: { gt: now } },
      orderBy: { startTime: "asc" },
      select: { id: true, startTime: true, capacity: true, bookedCount: true, service: { select: { name: true } } },
    }),
    prisma.booking.findMany({
      where: { providerId, status: { in: ["CANCELLED", "REJECTED"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      include: { service: true },
    }),
  ]);

  type BookingRow = {
    id: string;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    pricingUnitSnapshot: string | null;
    billableQuantitySnapshot: number | null;
    bookingTotalSnapshot: unknown;
    createdAt: Date;
    service: { name: unknown };
  };

  type BookingPreviewRow = BookingRow & {
    seats: number;
    availability: { startTime: Date } | null;
  };

  function toRecentActivityItem(booking: BookingRow): ProviderRecentBookingItem {
    return {
      id: booking.id,
      serviceName: extractLocalizedText(booking.service.name, locale) || fallbackServiceName,
      status: booking.status,
      priceSnapshot:
        booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
          ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
          : null,
      bookingMoney: bookingMoneyViewFromRow(booking),
      createdAt: booking.createdAt,
    };
  }

  const recentActivity = (recentBookings as BookingRow[]).map(toRecentActivityItem);
  const recentlyCancelledBookings = (recentlyCancelledRows as BookingRow[]).map(toRecentActivityItem);

  function toPreviewItem(booking: BookingPreviewRow): ProviderBookingPreviewItem {
    return {
      id: booking.id,
      serviceName: extractLocalizedText(booking.service.name, locale) || fallbackServiceName,
      status: booking.status,
      seats: booking.seats,
      priceSnapshot:
        booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
          ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
          : null,
      bookingMoney: bookingMoneyViewFromRow(booking),
      // Non-null by construction — both queries filter on
      // availability.startTime, which requires a real Availability row.
      slotStartTime: booking.availability!.startTime,
    };
  }

  const todaysBookings = (todaysBookingRows as BookingPreviewRow[]).map(toPreviewItem);
  const upcomingBookings = (upcomingBookingRows as BookingPreviewRow[]).map(toPreviewItem);

  const capacityAlerts: ProviderCapacityAlertItem[] = upcomingOpenSlotRows
    .filter((slot) => slot.bookedCount >= slot.capacity)
    .slice(0, 5)
    .map((slot) => ({
      id: slot.id,
      serviceName: extractLocalizedText(slot.service.name, locale) || fallbackServiceName,
      startTime: slot.startTime,
      capacity: slot.capacity,
    }));

  return {
    publishedServicesCount,
    draftServicesCount,
    activeBookingsCount,
    pendingConfirmationsCount,
    todaysBookingsCount,
    upcomingBookingsCount,
    upcomingOpenSlotsCount,
    todaysBookings,
    upcomingBookings,
    recentActivity,
    capacityAlerts,
    recentlyCancelledBookings,
  };
}
