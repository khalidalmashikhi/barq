import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/navigation";
import { UnauthenticatedError, isActiveAdminSession } from "@/lib/auth";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { cancelBooking } from "@/lib/booking/cancel-booking";
import { createReview } from "@/lib/booking/create-review";
import { canCancelBooking, canReviewBooking } from "@/lib/booking/cancellation-policy";
import { getBookingStatusLabel } from "@/lib/booking/booking-status";
import { isBookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import { getBookingErrorTranslationKey } from "@/lib/booking/booking-error-messages";
import { isReviewActionErrorCode } from "@/lib/booking/review-action-errors";
import { getReviewErrorTranslationKey } from "@/lib/booking/review-error-messages";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { CheckCircle2, Star } from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { resolveCustomerNavOptions } from "@/lib/dashboard/resolve-customer-nav-options";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getBookingTimeline } from "@/lib/booking/lifecycle/get-booking-timeline";
import { BookingTimeline } from "@/components/bookings/booking-timeline";
import { CancelBookingDialog } from "@/components/bookings/cancel-booking-dialog";
import { AssignedVehicleCard } from "@/components/bookings/assigned-vehicle-card";
import { BookingMoneyBreakdown } from "@/components/bookings/booking-money-breakdown";

// INTERNATIONALIZATION PHASE A.4 — REAL BUG FIXED: this page previously
// discarded cancelBooking()'s result entirely (`await cancelBooking(...)`
// with no branch on failure), so a cancellation that failed (wrong
// status, not found) gave the user zero feedback — just a silent
// redirect back to the same, unchanged page. Now the result is
// captured; on failure the page redirects with a stable error code
// (never localized text) which is validated via
// isBookingActionErrorCode() and resolved to a translated message
// before display — the same pattern already used on the booking form.

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; reviewed?: string }>;
};

// Phase B Group 5 Closure — private, authenticated route: explicit
// noindex/nofollow as defense-in-depth alongside the ownership check
// inside getBookingDetail() below (not a replacement for it). No
// canonical/hreflang — applies uniformly regardless of which booking
// id is requested.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function BookingDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, reviewed } = await searchParams;
  const locale = await getLocale();

  // Gate A (Admin Backoffice Hardening) — an ACTIVE Admin is backoffice-only:
  // redirect it to /admin SERVER-SIDE before any customer-capability read or action.
  if (await isActiveAdminSession()) {
    redirect({ href: "/admin", locale });
    return null;
  }

  // Phase C.2 — CRITICAL FIX: getBookingDetail() calls requireAuth()
  // internally, which throws UnauthenticatedError for an unauthenticated
  // request rather than returning null — previously uncaught here,
  // producing a raw 500 instead of a graceful redirect (verified live
  // during Phase B's final audit). Same catch-and-redirect pattern
  // already used by src/app/[locale]/dashboard/page.tsx and
  // src/app/[locale]/provider/layout.tsx for the identical error.
  // getBookingDetail()'s own ownership check (returns null for both
  // "doesn't exist" and "belongs to someone else") is unchanged and
  // remains the real security boundary — this only fixes what happens
  // when there is no session at all.
  let fetchedBooking;
  try {
    fetchedBooking = await getBookingDetail(id);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw err;
  }

  if (!fetchedBooking) {
    notFound();
    return null;
  }

  const booking = fetchedBooking;

  const canCancel = canCancelBooking(booking.status);
  const canReview = canReviewBooking(booking.status) && !booking.hasReview;

  // Customer Experience Platform — this is the exact same logic the
  // page's own inline <form action> used before (cancelBooking() call,
  // then redirect on success/failure) — only relocated to a named
  // function so it can be passed as a prop to the client-side
  // confirmation dialog below. cancel-booking.ts itself is untouched;
  // no new mutation, no new eligibility rule, no reason field.
  async function handleCancelBooking() {
    "use server";
    const result = await cancelBooking(booking.id);
    if (!result.ok) {
      redirect({ href: `/bookings/${booking.id}?error=${result.error}`, locale });
      return;
    }
    redirect({ href: `/bookings/${booking.id}`, locale });
  }

  const t = await getServerTranslator("booking");
  const tErrors = await getServerTranslator("errors");
  const tDashboard = await getServerTranslator("dashboard");
  const errorMessage = error
    ? isBookingActionErrorCode(error)
      ? tErrors(getBookingErrorTranslationKey(error))
      : isReviewActionErrorCode(error)
        ? tErrors(getReviewErrorTranslationKey(error))
        : null
    : null;
  const [unreadNotificationsCount, navOptions] = await Promise.all([getUnreadCount(), resolveCustomerNavOptions()]);
  const timelineEvents = await getBookingTimeline(booking.id);

  // Phase C.3 Group 3 — UX FIX: same missing-AppShell gap as
  // src/app/[locale]/bookings/page.tsx — see that file's comment.
  return (
    <AppShell
      navItems={getCustomerNavItems(tDashboard, locale, unreadNotificationsCount, navOptions)}
      roleLabel={tDashboard("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{booking.serviceName}</h1>
          <p className="mt-1 text-sm text-foreground/50">{booking.providerName}</p>
        </div>

        {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">{t("statusLabel")}</span>
            <span className="font-medium text-foreground">{getBookingStatusLabel(booking.status, t)}</span>
          </div>
          {/* BOOKING TOTAL PRESENTATION — authoritative TOTAL + (for a per-person booking) the
              unit × quantity breakdown (§14). `seats` below stays the physical guest count and is
              deliberately kept separate from any billable quantity. */}
          <BookingMoneyBreakdown money={booking.bookingMoney} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">{t("slotLabel")}</span>
            <span className="font-medium text-foreground">
              {booking.slotStartTime
                ? formatDate(new Date(booking.slotStartTime), locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : t("noSlotSelected")}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">{t("seatsLabel")}</span>
            <span className="font-medium text-foreground">{booking.seats}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">{t("requestDateLabel")}</span>
            <span className="font-medium text-foreground">
              {formatDate(new Date(booking.createdAt), locale, { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
        </div>

        {/* BOOKING-VEHICLE-2 — the specific vehicle assigned to THIS booking (historical
            snapshot only). Rendered solely when an assignment exists; the customer never
            sees a plate, a vehicle id, or any selector. Distinct from the Service page's
            representative pool card. */}
        {booking.assignedVehicle && (
          <AssignedVehicleCard
            vehicle={booking.assignedVehicle}
            labels={{
              title: t("assignedVehicleTitle"),
              untitled: t("assignedVehicleUntitled"),
              guestsSuffix: t("assignedVehicleGuestsSuffix"),
              fourByFour: t("assignedVehicle4x4Badge"),
            }}
          />
        )}

        {/* BOOKING FULFILLMENT LOGISTICS — booking-specific meeting/pickup instructions the
            provider authored, shown prominently while the booking is CONFIRMED/IN_PROGRESS (and
            retained on COMPLETED for reference; the read model returns null in every other,
            non-fulfillment status so nothing misleading appears). When active but not yet
            authored, a gentle non-alarming note. Kept SEPARATE from the generic service
            instructions block below (§11) — never merged. Rendered as plain text. */}
        {(booking.fulfillmentInstructions ||
          booking.status === "CONFIRMED" ||
          booking.status === "IN_PROGRESS") && (
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">{t("fulfillmentTitle")}</h2>
            {booking.fulfillmentInstructions ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {booking.fulfillmentInstructions}
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-foreground/50">{t("fulfillmentCustomerEmpty")}</p>
            )}
          </div>
        )}

        {/* §11 coexistence — the GENERIC, service-level start instructions, in their own block. */}
        {booking.serviceStartInstructions && (
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">{t("fulfillmentServiceTitle")}</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
              {booking.serviceStartInstructions}
            </p>
          </div>
        )}

        <BookingTimeline events={timelineEvents} />

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium text-foreground">{t("paymentSectionTitle")}</h2>
          {booking.paymentId ? (
            <Link
              href={`/payments/${booking.paymentId}`}
              className="shrink-0 rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            >
              {t("viewPaymentButton")}
            </Link>
          ) : (
            <span className="text-xs text-foreground/40">{t("noPaymentYetLabel")}</span>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("cancellationPolicyTitle")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground/70">{t("cancellationPolicyBody")}</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("refundNoticeTitle")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground/70">{t("refundNoticeBody")}</p>
          </div>
        </div>

        {canCancel && (
          <CancelBookingDialog
            action={handleCancelBooking}
            serviceName={booking.serviceName}
            triggerLabel={t("cancelButton")}
            titleLabel={t("cancelDialogTitle")}
            bodyLabel={t("cancelDialogBody")}
            cancelLabel={t("cancelDialogDismissButton")}
            confirmLabel={t("cancelDialogConfirmButton")}
            pendingLabel={t("cancelDialogPendingLabel")}
          />
        )}

        {/* Marketplace Completion (Review Creation Flow) — the review
            entry point only ever renders on the one surface a customer
            reaches after a genuinely completed booking. Three mutually
            exclusive states, computed from real server-side data
            (booking.status, booking.hasReview): a form (eligible,
            unreviewed), a submitted badge (eligible, already reviewed),
            or nothing at all (any other status) — never a disabled
            "Write a review" control sitting inertly on an ineligible
            booking. */}
        {booking.status === "COMPLETED" && (
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-medium text-foreground">{t("reviewSectionTitle")}</h2>

            {booking.hasReview ? (
              <div className="flex flex-col gap-3">
                {/* A fresh fetch after the redirect below already shows
                    hasReview: true — reviewed=1 is a one-time signal
                    that this render is the direct result of that
                    redirect, so the extra confirmation only shows once,
                    not on every future visit to this booking. */}
                {reviewed === "1" && <Alert variant="success">{t("reviewSubmittedDescription")}</Alert>}
                <div className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 size={16} strokeWidth={2} />
                  <span>{t("reviewSubmittedLabel")}</span>
                </div>
              </div>
            ) : canReview ? (
              <form
                className="flex flex-col gap-4"
                action={async (formData: FormData) => {
                  "use server";
                  const result = await createReview(booking.id, formData);
                  if (!result.ok) {
                    redirect({ href: `/bookings/${booking.id}?error=${result.error}`, locale });
                    return;
                  }
                  redirect({ href: `/bookings/${booking.id}?reviewed=1`, locale });
                }}
              >
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-xs font-medium text-foreground/50">{t("reviewRatingLabel")}</legend>
                  <div className="flex gap-3">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <label key={value} className="group cursor-pointer">
                        <input type="radio" name="rating" value={value} required className="peer sr-only" />
                        <span className="sr-only">{t("reviewStarValueLabel", { value })}</span>
                        <Star
                          size={26}
                          strokeWidth={1.5}
                          className="text-foreground/25 transition-colors peer-checked:text-accent peer-checked:fill-current peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 group-hover:text-accent/70"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground/50">{t("reviewContentLabel")}</span>
                  <textarea
                    name="content"
                    required
                    maxLength={2000}
                    rows={4}
                    placeholder={t("reviewContentPlaceholder")}
                    className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <SubmitButton className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                  {t("reviewSubmitButton")}
                </SubmitButton>
              </form>
            ) : null}
          </div>
        )}
      </main>
    </AppShell>
  );
}
