import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, ClipboardList, Star } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getCustomerDetail } from "@/lib/admin/get-customer-detail";
import { isValidUuid } from "@/lib/uuid";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Customer detail — Admin Operations Platform. Read-only, mirroring
// admin/services/[id]/page.tsx's "no nested-entity edit form" shape:
// identity (phone number, registration date), real counts, and bounded
// preview lists of this customer's own bookings/reviews, each linking
// to the existing Booking/Review admin surfaces. No name/email/avatar
// is shown or fabricated.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function CustomerDetailPage({ params }: Props) {
  const { id } = await params;
  const t = await getServerTranslator("admin");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let customer;
  try {
    customer = await getCustomerDetail(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw err;
  }

  if (!customer) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/customers" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToCustomersLabel")}
      </Link>

      <div>
        <h1 dir="ltr" className="text-start text-2xl font-semibold text-foreground">{customer.phoneNumber}</h1>
        <p className="mt-0.5 text-sm text-foreground/40">
          {t("customerRegisteredOnLabel")} {formatDate(customer.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("customerDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-foreground/40">{t("customerTotalBookingsLabel")}</dt>
            <dd className="text-sm text-foreground">{customer.bookingCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("customerTotalReviewsLabel")}</dt>
            <dd className="text-sm text-foreground">{customer.reviewCount}</dd>
          </div>
        </dl>
      </Card>

      <Card hoverLift={false}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList size={16} strokeWidth={1.75} className="text-foreground/40" />
          {t("customerBookingsGivenTitle")}
        </h2>
        {customer.recentBookings.length === 0 ? (
          <EmptyState icon={ClipboardList} iconSize={20} message={t("customerNoBookingsLabel")} gap="gap-1.5" padding="py-6" />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {customer.recentBookings.map((booking) => (
              <li key={booking.id}>
                <Link href={`/admin/bookings/${booking.id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-accent/10">
                  <span className="truncate text-sm text-foreground">{booking.serviceName}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getBookingStatusStyle(booking.status)}`}>
                    {getBookingStatusLabel(booking.status, tBooking)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card hoverLift={false}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Star size={16} strokeWidth={1.75} className="text-foreground/40" />
          {t("customerReviewsGivenTitle")}
        </h2>
        {customer.recentReviews.length === 0 ? (
          <EmptyState icon={Star} iconSize={20} message={t("customerNoReviewsLabel")} gap="gap-1.5" padding="py-6" />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {customer.recentReviews.map((review) => (
              <li key={review.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5">
                <span className="truncate text-sm text-foreground">{review.serviceName}</span>
                <span className="shrink-0 text-xs text-foreground/50">{review.rating}/5</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
