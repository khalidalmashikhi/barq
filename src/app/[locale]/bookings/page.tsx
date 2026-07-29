import type { Metadata } from "next";
import Link from "next/link";
import { Link as LocaleLink, redirect } from "@/i18n/navigation";
import { CalendarX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking/get-my-bookings";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { CustomerBookingFilters } from "@/components/bookings/customer-booking-filters";
import { BookingStatusProgress } from "@/components/bookings/booking-status-progress";

type SearchParams = {
  page?: string;
  q?: string;
  when?: string;
};

// Phase B Group 5 Closure — private, authenticated route: explicit
// noindex/nofollow as defense-in-depth alongside the auth gate below
// (not a replacement for it). No canonical/hreflang.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const locale = await getLocale();

  const session = await getSession();
  if (!session) {
    redirect({ href: "/login", locale });
  }

  const params = await searchParams;
  const t = await getServerTranslator("booking");
  const tDashboard = await getServerTranslator("dashboard");

  // Sanitize the page param the same way get-services.ts already
  // does: any non-positive-integer value falls back to page 1 rather
  // than being passed through as-is.
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;
  const when = params.when === "upcoming" || params.when === "past" ? params.when : undefined;

  const result = await getMyBookings({ page, search: params.q, when });
  const unreadNotificationsCount = await getUnreadCount();

  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const servicesPath = getPathname({ href: "/services", locale });
  const bookingsPath = getPathname({ href: "/bookings", locale });

  // Phase C.3 Group 3 — UX FIX: this page previously rendered as a bare
  // <main>, with no AppShell at all — a customer navigating here from
  // Dashboard's own "Bookings" nav link lost every bit of navigation
  // chrome (sidebar, top bar, logout) and had no way back except the
  // browser's own back button. Now wrapped in the same AppShell
  // Dashboard already uses, via the shared getCustomerNavItems() helper
  // (src/lib/dashboard/customer-nav-items.tsx) — Dashboard's own page
  // is left untouched.
  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <h1 className="text-2xl font-semibold text-foreground">{t("myBookingsTitle")}</h1>

        <CustomerBookingFilters basePath={bookingsPath} currentSearch={params.q} currentWhen={when} />

        {result.totalCount === 0 && !params.q && !when ? (
          <EmptyState
            icon={CalendarX}
            iconSize={32}
            gap="gap-3"
            padding="py-16"
            message={t("noBookingsLabel")}
            messageClassName="text-foreground/60"
            action={
              <Link
                href={servicesPath}
                className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t("browseExperiencesButton")}
              </Link>
            }
          />
        ) : result.totalCount === 0 ? (
          <EmptyState
            icon={CalendarX}
            iconSize={32}
            gap="gap-3"
            padding="py-16"
            message={t("noBookingsMatchFilterLabel")}
            messageClassName="text-foreground/60"
          />
        ) : isOutOfRangePage ? (
          <EmptyState
            icon={CalendarX}
            iconSize={32}
            gap="gap-3"
            padding="py-16"
            message={t("noBookingsOnPageLabel")}
            messageClassName="text-foreground/60"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {result.items.map((booking) => (
              <LocaleLink
                key={booking.id}
                href={`/bookings/${booking.id}`}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-premium"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{booking.serviceName}</p>
                    <p className="mt-0.5 text-xs text-foreground/40">
                      {booking.slotStartTime
                        ? formatDate(new Date(booking.slotStartTime), locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
                        : formatDate(new Date(booking.createdAt), locale, { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {booking.priceSnapshot && (
                      <span className="text-sm font-semibold text-primary">{booking.priceSnapshot}</span>
                    )}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(booking.status)}`}>
                      {getBookingStatusLabel(booking.status, t)}
                    </span>
                  </div>
                </div>
                <BookingStatusProgress status={booking.status} />
              </LocaleLink>
            ))}
          </div>
        )}

        <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={bookingsPath} />
      </main>
    </AppShell>
  );
}
