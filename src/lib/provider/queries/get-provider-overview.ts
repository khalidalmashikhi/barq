import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { extractText } from "@/lib/i18n/extract-text";

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
  priceSnapshot: string | null;
  createdAt: Date;
};

export type ProviderOverviewData = {
  publishedServicesCount: number;
  draftServicesCount: number;
  activeBookingsCount: number;
  todaysBookingsCount: number;
  upcomingBookingsCount: number;
  upcomingOpenSlotsCount: number;
  recentActivity: ProviderRecentBookingItem[];
};

export async function getProviderOverview(): Promise<ProviderOverviewData> {
  const { provider } = await requireProvider();
  const providerId = provider.id;

  const now = new Date();
  const { start: todayStart, end: todayEnd } = getOmanTodayRangeUtc(now);

  const [
    publishedServicesCount,
    draftServicesCount,
    activeBookingsCount,
    todaysBookingsCount,
    upcomingBookingsCount,
    upcomingOpenSlotsCount,
    recentBookings,
  ] = await Promise.all([
    prisma.service.count({ where: { providerId, status: "PUBLISHED" } }),
    prisma.service.count({ where: { providerId, status: "DRAFT" } }),
    // Broader than Customer dashboard's own "active" definition (which
    // excludes CREATED) — for a Provider, a pending/unconfirmed booking
    // is very much active business needing attention.
    prisma.booking.count({
      where: { providerId, status: { in: ["CREATED", "CONFIRMED", "IN_PROGRESS"] } },
    }),
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
  ]);

  type BookingRow = {
    id: string;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
  };

  const recentActivity = (recentBookings as BookingRow[]).map((booking) => ({
    id: booking.id,
    serviceName: extractText(booking.service.name) || "تجربة",
    status: booking.status,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
    createdAt: booking.createdAt,
  }));

  return {
    publishedServicesCount,
    draftServicesCount,
    activeBookingsCount,
    todaysBookingsCount,
    upcomingBookingsCount,
    upcomingOpenSlotsCount,
    recentActivity,
  };
}
