import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, CreditCard } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderBookingDetail } from "@/lib/provider/queries/get-provider-booking-detail";
import { getBookingAcceptanceVehicleOptions } from "@/lib/provider/queries/get-booking-acceptance-vehicles";
import { BookingAcceptanceVehiclePicker } from "@/components/bookings/booking-acceptance-vehicle-picker";
import { getBookingTimeline } from "@/lib/booking/lifecycle/get-booking-timeline";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { acceptBooking } from "@/lib/booking/accept-booking";
import { rejectBooking } from "@/lib/booking/reject-booking";
import { startBooking } from "@/lib/booking/start-booking";
import { completeBooking } from "@/lib/booking/complete-booking";
import { canStartBooking, canCompleteBooking } from "@/lib/booking/cancellation-policy";
import { isBookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import { getBookingErrorTranslationKey } from "@/lib/booking/booking-error-messages";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookingTimeline } from "@/components/bookings/booking-timeline";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Payment Experience & Financial Operations phase — additive cross-
// link only. No new query: this reuses getProviderPayments()'s own
// existing bookingId filter (already ownership-scoped via
// booking.providerId), so the link never needs to know whether a
// Payment actually exists for this booking — the destination page
// itself renders its own honest empty state when there isn't one.

// Provider Booking Detail — Provider Operations Foundation, Priority 1.
//
// REUSES, DOES NOT DUPLICATE: getBookingTimeline() (Phase E.1) and the
// 4 existing lifecycle actions (acceptBooking/rejectBooking/
// startBooking/completeBooking, all already gated by
// cancellation-policy.ts's transition matrix) are the exact same
// functions provider/bookings/page.tsx already calls — only the
// redirect target changes (back to this detail page instead of the
// list). No new lifecycle logic, no new timeline query.
//
// OWNERSHIP: getProviderBookingDetail() resolves provider.id internally
// via requireProvider() and returns null uniformly for a malformed id,
// a missing booking, or a booking belonging to another provider —
// mirroring getProviderServiceDetail()'s established convention.

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function ProviderBookingDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const locale = await getLocale();

  let booking;
  try {
    booking = await getProviderBookingDetail(id);
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

  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");
  const tErrors = await getServerTranslator("errors");
  const tPayments = await getServerTranslator("payments");
  const errorMessage = error && isBookingActionErrorCode(error) ? tErrors(getBookingErrorTranslationKey(error)) : null;

  const timelineEvents = await getBookingTimeline(booking.id);

  const needsAction = booking.status === "PENDING_PROVIDER";
  const canStart = canStartBooking(booking.status);
  const canComplete = canCompleteBooking(booking.status);

  // BOOKING-VEHICLE-1 — the provider chooses the vehicle at acceptance for a transport tour.
  // null for non-tour / GUIDE_ONLY (no selector — acceptance is unchanged). When a vehicle
  // is REQUIRED but none is currently eligible, Accept is withheld (never auto-reject, §10).
  const vehicleOptions = needsAction ? await getBookingAcceptanceVehicleOptions(booking.id) : null;
  const hasEligibleVehicle = vehicleOptions ? vehicleOptions.candidates.some((c) => c.eligible) : false;
  const blockAccept = (vehicleOptions?.vehicleRequired ?? false) && !hasEligibleVehicle;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/bookings"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToBookingsLabel")}
      </Link>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-foreground">{booking.serviceName}</h1>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${getBookingStatusStyle(booking.status)}`}>
            {getBookingStatusLabel(booking.status, tBooking)}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-foreground/50">{tBooking("slotLabel")}</span>
            <span className="font-medium text-foreground">
              {booking.slotStartTime
                ? formatDate(booking.slotStartTime, locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : tBooking("noSlotSelected")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-foreground/50">{tBooking("seatsLabel")}</span>
            <span className="font-medium text-foreground">{booking.seats}</span>
          </div>
          {booking.priceSnapshot && (
            <div className="flex items-center justify-between">
              <span className="text-foreground/50">{tBooking("priceLabel")}</span>
              <span className="font-medium text-primary">{booking.priceSnapshot}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-foreground/50">{tBooking("requestDateLabel")}</span>
            <span className="font-medium text-foreground">
              {formatDate(booking.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
        </div>
      </Card>

      <Link
        href={`/provider/payments?bookingId=${booking.id}`}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20"
      >
        <CreditCard size={14} strokeWidth={1.75} />
        {tPayments("viewPaymentsLabel")}
      </Link>

      {(needsAction || canStart || canComplete) && (
        <Card hoverLift={false}>
          <div className="flex flex-col gap-4">
            {needsAction && (
              <div className="flex flex-col gap-4">
                {/* Vehicle required but none currently eligible — show the reasons, withhold Accept. */}
                {blockAccept && vehicleOptions && <BookingAcceptanceVehiclePicker options={vehicleOptions} />}

                {!blockAccept && (
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      // The provider's chosen vehicle (radio) — validated server-side by acceptBooking.
                      const raw = formData.get("vehicleId");
                      const vehicleId = typeof raw === "string" && raw.length > 0 ? raw : null;
                      const result = await acceptBooking(booking.id, vehicleId);
                      redirect({ href: `/provider/bookings/${booking.id}${result.ok ? "" : `?error=${result.error}`}`, locale });
                    }}
                    className="flex flex-col gap-3"
                  >
                    {vehicleOptions && <BookingAcceptanceVehiclePicker options={vehicleOptions} />}
                    <SubmitButton className="w-fit rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                      {t("acceptBookingButton")}
                    </SubmitButton>
                  </form>
                )}

                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const reasonRaw = formData.get("reason");
                    const reason = typeof reasonRaw === "string" ? reasonRaw : undefined;
                    const result = await rejectBooking(booking.id, reason);
                    redirect({ href: `/provider/bookings/${booking.id}${result.ok ? "" : `?error=${result.error}`}`, locale });
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    name="reason"
                    placeholder={t("rejectReasonPlaceholder")}
                    maxLength={280}
                    className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <SubmitButton className="shrink-0 rounded-full border border-danger/30 bg-danger/5 px-4 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50">
                    {t("rejectBookingButton")}
                  </SubmitButton>
                </form>
              </div>
            )}
            {(canStart || canComplete) && (
              <div className="flex flex-wrap items-center gap-2">
                {canStart && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await startBooking(booking.id);
                      redirect({ href: `/provider/bookings/${booking.id}${result.ok ? "" : `?error=${result.error}`}`, locale });
                    }}
                  >
                    <SubmitButton className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                      {t("startBookingButton")}
                    </SubmitButton>
                  </form>
                )}
                {canComplete && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await completeBooking(booking.id);
                      redirect({ href: `/provider/bookings/${booking.id}${result.ok ? "" : `?error=${result.error}`}`, locale });
                    }}
                  >
                    <SubmitButton className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                      {t("completeBookingButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      <BookingTimeline events={timelineEvents} />
    </div>
  );
}
