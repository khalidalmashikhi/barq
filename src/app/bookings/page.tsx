import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking/get-my-bookings";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n/strings";

type SearchParams = {
  page?: string;
};

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  const params = await searchParams;

  // Sanitize the page param the same way get-services.ts already
  // does: any non-positive-integer value falls back to page 1 rather
  // than being passed through as-is.
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const result = await getMyBookings({ page });

  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">حجوزاتي</h1>

      {result.totalCount === 0 ? (
        <EmptyState
          icon={CalendarX}
          iconSize={32}
          gap="gap-3"
          padding="py-16"
          message="لا توجد حجوزات بعد"
          messageClassName="text-foreground/60"
          action={
            <Link
              href="/services"
              className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              تصفح التجارب
            </Link>
          }
        />
      ) : isOutOfRangePage ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <CalendarX size={32} strokeWidth={1.5} className="text-foreground/25" />
          <p className="text-foreground/60">{t.noBookingsOnPageLabel}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((booking) => (
            <Link
              key={booking.id}
              href={`/bookings/${booking.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-premium"
            >
              <div>
                <p className="font-medium text-foreground">{booking.serviceName}</p>
                <p className="mt-0.5 text-xs text-foreground/40">
                  {new Date(booking.createdAt).toLocaleDateString("ar-OM", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {booking.priceSnapshot && (
                  <span className="text-sm font-semibold text-primary">{booking.priceSnapshot}</span>
                )}
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(booking.status)}`}>
                  {getBookingStatusLabel(booking.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath="/bookings" />
    </main>
  );
}
