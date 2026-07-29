import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, UserRound, Users, Compass, Star, CreditCard } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getBookingDetail } from "@/lib/admin/get-booking-detail";
import { cancelBooking } from "@/lib/admin/cancel-booking";
import { canCancelBooking } from "@/lib/booking/cancellation-policy";
import { getBookingTimeline } from "@/lib/booking/lifecycle";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { isBookingAdminActionErrorCode, getBookingAdminErrorTranslationKey } from "@/lib/admin/booking-admin-errors";
import { isValidUuid } from "@/lib/uuid";
import { BookingTimeline } from "@/components/bookings/booking-timeline";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Booking detail — Phase 2.10 (Booking Admin UI). Mirrors
// admin/availability/[id]/page.tsx's/admin/prices/[id]/page.tsx's
// shape: status-changing actions live here, the list row keeps a
// single-click quick action too. Read-only otherwise — no edit form
// exists, since Booking editing is explicitly out of scope.
//
// TIMELINE: reuses the pre-existing <BookingTimeline> component
// (Phase F.2) and getBookingTimeline() (Phase E.1) directly, unscoped —
// no new timeline UI, no new query. This is the same real
// BookingStatusEvent history already shown on the customer-facing
// booking detail page, now also visible to admins.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AdminBookingDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let booking;
  try {
    booking = await getBookingDetail(id);
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

  if (!booking) {
    notFound();
  }

  const timeline = await getBookingTimeline(id);
  const errorMessage = error && isBookingAdminActionErrorCode(error) ? t(getBookingAdminErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/bookings" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToBookingsLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{booking.serviceName}</h1>
          <p className="mt-0.5 text-sm text-foreground/40">{booking.providerName}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${getBookingStatusStyle(booking.status)}`}>
          {getBookingStatusLabel(booking.status, tBooking)}
        </span>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("bookingDetailsTitle")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-foreground/40">{t("bookingServiceLabel")}</dt>
            <dd className="text-sm text-foreground">{booking.serviceName}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("bookingProviderLabel")}</dt>
            <dd className="text-sm text-foreground">{booking.providerName}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("bookingCustomerIdLabel")}</dt>
            <dd className="text-sm text-foreground">{booking.customerId}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/40">{t("bookingSeatsFieldLabel")}</dt>
            <dd className="text-sm text-foreground">{booking.seats}</dd>
          </div>
          {booking.slotStartTime && (
            <div>
              <dt className="text-xs text-foreground/40">{t("bookingSlotTimeLabel")}</dt>
              <dd className="text-sm text-foreground">
                {formatDate(booking.slotStartTime, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                {booking.slotEndTime && <> – {formatDate(booking.slotEndTime, locale, { hour: "2-digit", minute: "2-digit" })}</>}
              </dd>
            </div>
          )}
          {booking.priceSnapshot && (
            <div>
              <dt className="text-xs text-foreground/40">{t("bookingPriceLabel")}</dt>
              <dd className="text-sm text-foreground">{booking.priceSnapshot}</dd>
            </div>
          )}
          {booking.commissionSnapshot && (
            <div>
              <dt className="text-xs text-foreground/40">{t("bookingCommissionLabel")}</dt>
              <dd className="text-sm text-foreground">
                {booking.commissionSnapshot.amount} ({booking.commissionSnapshot.tier})
              </dd>
            </div>
          )}
          {booking.confirmedAt && (
            <div>
              <dt className="text-xs text-foreground/40">{t("bookingConfirmedAtLabel")}</dt>
              <dd className="text-sm text-foreground">
                {formatDate(booking.confirmedAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-foreground/40">{t("bookingCreatedAtLabel")}</dt>
            <dd className="text-sm text-foreground">
              {formatDate(booking.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </dd>
          </div>
        </dl>
      </Card>

      <BookingTimeline events={timeline} />

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("relatedTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`/admin/customers/${booking.customerId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <UserRound size={14} strokeWidth={1.75} />
            {t("viewBookingCustomerLabel")}
          </Link>
          <Link
            href={`/admin/providers/${booking.providerId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Users size={14} strokeWidth={1.75} />
            {t("viewBookingProviderLabel")}
          </Link>
          <Link
            href={`/admin/services/${booking.serviceId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
          >
            <Compass size={14} strokeWidth={1.75} />
            {t("viewBookingServiceLabel")}
          </Link>
          {booking.reviewId && (
            <Link
              href={`/admin/reviews?bookingId=${booking.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            >
              <Star size={14} strokeWidth={1.75} />
              {t("viewBookingReviewLabel")}
            </Link>
          )}
          {booking.paymentId && (
            <Link
              href={`/admin/payments/${booking.paymentId}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            >
              <CreditCard size={14} strokeWidth={1.75} />
              {t("viewBookingPaymentLabel")}
            </Link>
          )}
        </div>
      </Card>

      {canCancelBooking(booking.status) && (
        <Card hoverLift={false}>
          <h2 className="text-sm font-semibold text-foreground">{t("bookingActionsTitle")}</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <form
              action={async () => {
                "use server";
                const result = await cancelBooking(id);
                if (!result.ok) {
                  redirect({ href: `/admin/bookings/${id}?error=${result.error}`, locale });
                  return;
                }
                redirect({ href: `/admin/bookings/${id}`, locale });
              }}
            >
              <SubmitButton className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                {t("cancelBookingButton")}
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
}
