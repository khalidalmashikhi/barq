import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { BookingStatus } from "@prisma/client";
import type { Locale } from "@/i18n/locales";

// Provider operational insights — Admin Operations Platform.
//
// Every list here uses a single Prisma relation filter (`none`/`some`)
// rather than a per-provider count query — this is what avoids N+1
// entirely: Prisma compiles `services: { none: {} }` into one SQL
// query with a NOT EXISTS subquery, not one query per provider.
//
// PROVIDERS WITH NO RECENT BOOKING ACTIVITY — documented rule (approved
// this phase): a provider with no booking in CONFIRMED, IN_PROGRESS, or
// COMPLETED whose `updatedAt` falls within the last 30 days. Booking
// has no per-status timestamp that would cleanly represent "when this
// specific status was entered" for all three statuses at once
// (`confirmedAt` is set once, at the CONFIRMED transition, and stays
// fixed through IN_PROGRESS/COMPLETED — it does not advance further,
// and is nullable for bookings that never reached CONFIRMED) — so this
// deliberately uses the simplified, always-non-null `updatedAt` bound
// approved for exactly this situation, not a mix of different
// timestamp fields per status. The label is intentionally "No Recent
// Booking Activity," never "Inactive," since a provider here may be
// fully approved, visible, and simply between bookings.
export const NO_RECENT_ACTIVITY_WINDOW_DAYS = 30;
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];

export type ProviderInsightItem = {
  id: string;
  businessName: string;
  createdAt: Date;
};

export type ProviderInsights = {
  providersWithoutServices: ProviderInsightItem[];
  providersWithoutServicesCount: number;
  providersWithNoCompletedBookings: ProviderInsightItem[];
  providersWithNoCompletedBookingsCount: number;
  providersWithNoRecentActivity: ProviderInsightItem[];
  providersWithNoRecentActivityCount: number;
};

const PREVIEW_LIMIT = 5;

function toInsightItem(provider: { id: string; businessName: unknown; createdAt: Date }, locale: Locale): ProviderInsightItem {
  return {
    id: provider.id,
    businessName: extractLocalizedText(provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    createdAt: provider.createdAt,
  };
}

export async function getProviderInsights(): Promise<ProviderInsights> {
  await requireAdmin();
  const locale = await getLocale();

  const noRecentActivitySince = new Date(Date.now() - NO_RECENT_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const withoutServicesWhere = { services: { none: {} } };
  const withoutCompletedBookingsWhere = { bookings: { none: { status: "COMPLETED" as const } } };
  const withoutRecentActivityWhere = {
    bookings: { none: { status: { in: ACTIVE_BOOKING_STATUSES }, updatedAt: { gte: noRecentActivitySince } } },
  };

  const [
    providersWithoutServicesCount,
    providersWithoutServicesRows,
    providersWithNoCompletedBookingsCount,
    providersWithNoCompletedBookingsRows,
    providersWithNoRecentActivityCount,
    providersWithNoRecentActivityRows,
  ] = await Promise.all([
    prisma.provider.count({ where: withoutServicesWhere }),
    prisma.provider.findMany({
      where: withoutServicesWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
    }),
    prisma.provider.count({ where: withoutCompletedBookingsWhere }),
    prisma.provider.findMany({
      where: withoutCompletedBookingsWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
    }),
    prisma.provider.count({ where: withoutRecentActivityWhere }),
    prisma.provider.findMany({
      where: withoutRecentActivityWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
    }),
  ]);

  return {
    providersWithoutServices: providersWithoutServicesRows.map((p) => toInsightItem(p, locale)),
    providersWithoutServicesCount,
    providersWithNoCompletedBookings: providersWithNoCompletedBookingsRows.map((p) => toInsightItem(p, locale)),
    providersWithNoCompletedBookingsCount,
    providersWithNoRecentActivity: providersWithNoRecentActivityRows.map((p) => toInsightItem(p, locale)),
    providersWithNoRecentActivityCount,
  };
}
