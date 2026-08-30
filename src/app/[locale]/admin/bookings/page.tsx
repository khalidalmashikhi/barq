import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { CalendarX } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getBookings } from "@/lib/admin/get-bookings";
import { formatBookingTotal } from "@/lib/booking/pricing/booking-money-view";
import { cancelBooking } from "@/lib/admin/cancel-booking";
import { canCancelBooking } from "@/lib/booking/cancellation-policy";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { isBookingAdminActionErrorCode, getBookingAdminErrorTranslationKey } from "@/lib/admin/booking-admin-errors";
import { BookingFilters } from "@/components/admin/booking-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import type { BookingStatus } from "@prisma/client";

// Admin Bookings — Phase 2.10 (Booking Admin UI), consuming the Phase
// 2.9 (Booking Foundation) admin actions/queries only. Mirrors
// admin/availability/page.tsx's/admin/prices/page.tsx's list-page shape
// exactly: flat row-list, one-click quick action, no new UI pattern.
// No Create button — Booking creation is explicitly out of scope this
// phase (Checkout Foundation, not yet built).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const BOOKING_STATUSES: BookingStatus[] = [
  "CREATED",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DISPUTED",
  "EXPIRED",
];

// Admin Operations Platform additions (all additive):
// - `providerId`/`serviceId` — getBookings() already accepted both;
//   this page now reads them from the URL so the Provider/Service
//   detail pages' new "Bookings" cross-links actually filter the list.
// - `status` may now be a comma-separated list (e.g. "CANCELLED,REJECTED")
//   — used by the admin overview's "Recently Cancelled" queue's
//   "View all" link, which spans both statuses at once. A single
//   status value still works exactly as before.
type SearchParams = { q?: string; status?: string; providerId?: string; serviceId?: string; page?: string; error?: string };

function parseStatusParam(raw: string | undefined): BookingStatus | BookingStatus[] | undefined {
  if (!raw) return undefined;
  const candidates = raw.split(",").filter((value): value is BookingStatus => BOOKING_STATUSES.includes(value as BookingStatus));
  if (candidates.length === 0) return undefined;
  return candidates.length === 1 ? candidates[0] : candidates;
}

export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  const status = parseStatusParam(params.status);
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getBookings() calls requireAdmin() internally — same catch-and-
  // handle pattern as every other role-gated query call site, even
  // though admin/layout.tsx already gates this route: defense in
  // depth, not redundancy.
  let result;
  try {
    result = await getBookings({ q: params.q, status, providerId: params.providerId, serviceId: params.serviceId, page });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  const hasActiveFilter = Boolean(params.q || params.status || params.providerId || params.serviceId);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const bookingsBasePath = getPathname({ href: "/admin/bookings", locale });
  const errorMessage = params.error && isBookingAdminActionErrorCode(params.error) ? t(getBookingAdminErrorTranslationKey(params.error)) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("bookingAdminTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("bookingAdminDescription")}</p>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <BookingFilters currentSearch={params.q} currentStatus={params.status} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CalendarX} message={t("noBookingsManagedLabel")} description={t("noBookingsManagedDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CalendarX} message={t("bookingNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CalendarX} message={t("noBookingMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((booking) => (
            <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/bookings/${booking.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{booking.serviceName}</p>
                <p className="mt-0.5 truncate text-xs text-foreground/40">
                  {booking.providerName} · {booking.seats} {t("bookingSeatsLabel")}
                  {booking.slotStartTime && (
                    <> · {formatDate(new Date(booking.slotStartTime), locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>
                  )}
                  {/* BOOKING TOTAL PRESENTATION — effective booking total, not the unit price. */}
                  {formatBookingTotal(booking.bookingMoney) && <> · {formatBookingTotal(booking.bookingMoney)}</>}
                </p>
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(booking.status)}`}>
                  {getBookingStatusLabel(booking.status, tBooking)}
                </span>

                {canCancelBooking(booking.status) && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await cancelBooking(booking.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/bookings?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/bookings", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                      {t("cancelBookingButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={bookingsBasePath} />
    </div>
  );
}
