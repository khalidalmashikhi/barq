import { CalendarX } from "lucide-react";
import { getProviderBookings } from "@/lib/provider/queries/get-provider-bookings";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { ProviderBookingFilters } from "@/components/bookings/provider-booking-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import type { BookingStatus } from "@prisma/client";

// Provider Bookings — Provider Dashboard Phase 1c (Bookings Workspace
// Foundation, read-only). No accept/reject/cancel/status-change exists
// here — this phase is strictly a read-only operational overview. Auth
// is handled entirely by src/app/provider/layout.tsx and,
// independently, by getProviderBookings()'s own requireProvider()
// call — this page performs no auth logic of its own.
//
// CUSTOMER IDENTITY: no name/phone/email is ever rendered — only the
// generic provider.bookingCustomerLabel ("Customer"/"عميل"), per
// explicit product decision (see get-provider-bookings.ts's own note
// on why no customer-identifying field exists in the DTO at all).
//
// ROWS, NOT A DETAIL LINK YET: each row is a single wrapping <div>,
// keyed by and built around the real booking id — not yet a <Link>
// (no /provider/bookings/[id] exists this phase), but structured so
// that page can be added later without restructuring this list,
// mirroring Phase 1b's identical decision for Services.

const VALID_STATUSES: BookingStatus[] = ["CREATED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DISPUTED"];

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
};

export default async function ProviderBookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  const status = VALID_STATUSES.includes(params.status as BookingStatus) ? (params.status as BookingStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const result = await getProviderBookings({ q: params.q, status, page });

  const hasActiveFilter = Boolean(params.q || params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <h1 className="text-2xl font-semibold text-foreground">{t("bookingsTitle")}</h1>

      <ProviderBookingFilters currentSearch={params.q} currentStatus={params.status} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CalendarX} message={t("noBookingsLabel")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CalendarX} message={tBooking("noBookingsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CalendarX} message={t("noBookingsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <div>
                <p className="font-medium text-foreground">{item.serviceName}</p>
                <p className="mt-0.5 text-xs text-foreground/40">
                  {t("bookingCustomerLabel")} ·{" "}
                  {formatDate(new Date(item.createdAt), locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground/50">×{item.seats}</span>
                {item.priceSnapshot && <span className="text-sm font-semibold text-primary">{item.priceSnapshot}</span>}
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(item.status)}`}>
                  {getBookingStatusLabel(item.status)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath="/provider/bookings" />
    </div>
  );
}
