import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Star, PenLine, MessageSquareText } from "lucide-react";
import { redirect, getPathname } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError } from "@/lib/auth";
import { getMyReviewsPageData } from "@/lib/booking/get-my-reviews";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { resolveCustomerNavOptions } from "@/lib/dashboard/resolve-customer-nav-options";
import { AppShell } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { formatDate } from "@/lib/i18n/format-date";

// My Reviews — Customer Experience Platform.
//
// TWO CLEARLY SEPARATED SECTIONS, NOT A DUPLICATE REVIEW FORM:
// "Awaiting Review" only ever links to the existing booking detail
// page (/bookings/[id]) — the one and only surface a review is actually
// submitted from (create-review.ts's form, unchanged by this phase).
// "Reviews Given" is read-only presentation of this customer's own
// Review rows — no edit/delete UI, since neither exists in this
// codebase and this phase does not add one.
//
// NO SCHEMA CHANGE, NO NEW ELIGIBILITY RULE: getMyReviewsPageData()
// (src/lib/booking/get-my-reviews.ts) is the only new query behind this
// page — it re-derives the exact same "COMPLETED + no Review" predicate
// create-review.ts's own canReviewBooking() already enforces at write
// time, as a read-only projection.

type Props = {
  searchParams: Promise<{ page?: string }>;
};

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReviewsPage({ searchParams }: Props) {
  const locale = await getLocale();
  const params = await searchParams;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  let data;
  try {
    data = await getMyReviewsPageData({ page });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw error;
  }

  if (data.reviewsGivenTotalCount > 0 && data.reviewsGiven.length === 0 && page !== 1) {
    notFound();
  }

  const t = await getServerTranslator("booking");
  const tDashboard = await getServerTranslator("dashboard");
  const [unreadNotificationsCount, navOptions] = await Promise.all([getUnreadCount(), resolveCustomerNavOptions()]);

  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount, navOptions)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <h1 className="text-2xl font-semibold text-foreground">{t("reviewsPageTitle")}</h1>

        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <PenLine size={18} strokeWidth={1.75} aria-hidden />
            {t("awaitingReviewSectionTitle")}
          </h2>

          {data.awaitingReview.length === 0 ? (
            <EmptyState icon={PenLine} iconSize={28} gap="gap-2" padding="py-10" message={t("noAwaitingReviewLabel")} />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.awaitingReview.map((booking) => (
                <li
                  key={booking.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <span className="font-medium text-foreground">{booking.serviceName}</span>
                  <Link
                    href={`/bookings/${booking.id}`}
                    className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {t("awaitingReviewCtaLabel")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <MessageSquareText size={18} strokeWidth={1.75} aria-hidden />
            {t("reviewsGivenSectionTitle")}
          </h2>

          {data.reviewsGiven.length === 0 ? (
            <EmptyState icon={Star} iconSize={28} gap="gap-2" padding="py-10" message={t("noReviewsGivenLabel")} />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.reviewsGiven.map((review) => (
                <li key={review.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-foreground">{review.serviceName}</p>
                      <p className="text-xs text-foreground/40">{review.providerName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5" aria-label={t("reviewStarValueLabel", { value: review.rating })}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Star
                          key={value}
                          size={14}
                          strokeWidth={1.5}
                          aria-hidden
                          className={value <= review.rating ? "fill-current text-accent" : "text-foreground/20"}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-foreground/70">{review.content}</p>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-foreground/40">
                      {formatDate(new Date(review.createdAt), locale, { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                    <Link
                      href={`/bookings/${review.bookingId}`}
                      className="rounded text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      {t("viewBookingLabel")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            searchParams={params}
            basePath={getPathname({ href: "/reviews", locale })}
          />
        </section>
      </div>
    </AppShell>
  );
}
