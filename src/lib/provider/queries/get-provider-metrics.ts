import "server-only";
import { Prisma, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { aggregateEffectiveBookingTotalByCurrency } from "@/lib/booking/pricing/effective-total-aggregate";

// Provider Metrics — Phase F.3 (KPI Cards, Revenue/Occupancy summary).
//
// EVERY VALUE HERE IS A REAL AGGREGATE OVER EXISTING COLUMNS — no rate,
// total, or count is invented. This module exists specifically because
// no prior query computed a rate (completion/cancellation) or a
// revenue/occupancy total; those require a GROUP BY / SUM the existing
// list queries don't do, not a schema change or a new business rule.
//
// REVENUE SOURCE, DELIBERATE CHOICE: sums Booking.priceSnapshotAmount
// for COMPLETED bookings, not Wallet/WalletTransaction. Wallet exists
// in the schema but is only ever populated by the (unbuilt, out of
// scope) Payments context — summing an empty ledger would show a
// confusingly-always-zero "Revenue" for every provider. A completed
// booking's own price snapshot is real, already-stored, per-provider
// data that exists today. This is presentation-layer aggregation of
// data already captured at booking-confirmation time, not a new
// business rule — see Booking.priceSnapshotAmount's own schema comment
// ("Price snapshot at confirmation — fixed per DOMAIN_MODEL invariant").
//
// RATES ARE null, NEVER 0, WHEN THERE IS NO DATA TO COMPUTE THEM FROM —
// a provider with zero bookings has an undefined completion rate, not
// a 0% one; the UI must render an honest "—", not a misleading 0%.

export type ProviderTopService = {
  serviceId: string;
  serviceName: string;
  bookingsCount: number;
};

/// Provider Analytics & Business Insights — a real per-status count,
/// built from the SAME groupBy this module already ran for
/// completed/cancelledBookingsCount below (Prisma's own groupBy(by:
/// ["status"]) already computes every BookingStatus value present in
/// one query; only 2 of the 9 were previously read from it before this
/// was added). No new query — this is stopping the discard, not a new
/// aggregation. Only statuses with at least one real booking are
/// included (a status with zero bookings simply never appears in
/// Prisma's groupBy result), so this is never padded with fabricated
/// zero rows.
export type ProviderBookingStatusCount = {
  status: BookingStatus;
  count: number;
};

export type ProviderMetrics = {
  totalBookingsCount: number;
  completedBookingsCount: number;
  cancelledBookingsCount: number;
  completionRate: number | null;
  cancellationRate: number | null;
  /// Formatted "{amount} {currency}" summed across every currency the
  /// provider's COMPLETED bookings actually used — null if none.
  /// Multi-currency is shown as multiple lines, never silently summed
  /// across currencies (that would be a real correctness bug, not a
  /// simplification).
  totalRevenueByCurrency: Array<{ amount: string; currency: string }>;
  /// bookedCount / capacity across the provider's upcoming (state=OPEN
  /// or already booked-into, startTime in the future) Availability
  /// rows. null when there is no upcoming capacity to divide by.
  occupancyRate: number | null;
  topServices: ProviderTopService[];
  bookingsByStatus: ProviderBookingStatusCount[];
};

export async function getProviderMetrics(): Promise<ProviderMetrics> {
  const { provider } = await requireProvider();
  const providerId = provider.id;
  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";
  const now = new Date();

  const [statusCounts, revenueByCurrency, occupancyRows, topServiceRows] = await Promise.all([
    prisma.booking.groupBy({
      by: ["status"],
      where: { providerId },
      _count: true,
    }),
    // DOWNSTREAM MONEY ALIGNMENT — completed gross revenue now sums the EFFECTIVE booking total
    // (COALESCE(bookingTotalSnapshot, priceSnapshotAmount)) per currency, via the shared seam,
    // so a multi-quantity totalized booking counts its real total (not the unit price). Legacy
    // rows keep unit semantics. This is GMV/gross booking value, NOT provider net (unchanged).
    aggregateEffectiveBookingTotalByCurrency(
      Prisma.sql`"providerId" = ${providerId}::uuid AND status = 'COMPLETED'`
    ),
    prisma.availability.findMany({
      where: { service: { providerId }, startTime: { gt: now }, state: { not: "CANCELLED" } },
      select: { capacity: true, bookedCount: true },
    }),
    prisma.booking.groupBy({
      by: ["serviceId"],
      where: { providerId },
      _count: true,
      orderBy: { _count: { serviceId: "desc" } },
      take: 5,
    }),
  ]);

  const totalBookingsCount = statusCounts.reduce((sum, row) => sum + row._count, 0);
  const completedBookingsCount = statusCounts.find((row) => row.status === "COMPLETED")?._count ?? 0;
  const cancelledBookingsCount = statusCounts.find((row) => row.status === "CANCELLED")?._count ?? 0;
  const bookingsByStatus: ProviderBookingStatusCount[] = statusCounts.map((row) => ({
    status: row.status,
    count: row._count,
  }));

  const completionRate = totalBookingsCount > 0 ? completedBookingsCount / totalBookingsCount : null;
  const cancellationRate = totalBookingsCount > 0 ? cancelledBookingsCount / totalBookingsCount : null;

  const totalRevenueByCurrency = revenueByCurrency.map((row) => ({
    amount: row.sum,
    currency: row.currency,
  }));

  const totalCapacity = occupancyRows.reduce((sum, row) => sum + row.capacity, 0);
  const totalBooked = occupancyRows.reduce((sum, row) => sum + row.bookedCount, 0);
  const occupancyRate = totalCapacity > 0 ? totalBooked / totalCapacity : null;

  const serviceIds = topServiceRows.map((row) => row.serviceId);
  const services = serviceIds.length > 0
    ? await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
    : [];
  const serviceNameById = new Map(services.map((s) => [s.id, extractLocalizedText(s.name, locale) || fallbackServiceName]));

  const topServices: ProviderTopService[] = topServiceRows.map((row) => ({
    serviceId: row.serviceId,
    serviceName: serviceNameById.get(row.serviceId) ?? fallbackServiceName,
    bookingsCount: row._count,
  }));

  return {
    totalBookingsCount,
    completedBookingsCount,
    cancelledBookingsCount,
    completionRate,
    cancellationRate,
    totalRevenueByCurrency,
    occupancyRate,
    topServices,
    bookingsByStatus,
  };
}
