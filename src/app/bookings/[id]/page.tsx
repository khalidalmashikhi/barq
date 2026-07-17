import { notFound, redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { cancelBooking } from "@/lib/booking/cancel-booking";
import { canCancelBooking } from "@/lib/booking/cancellation-policy";
import { getBookingStatusLabel } from "@/lib/booking/booking-status";
import { isBookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import { getBookingErrorTranslationKey } from "@/lib/booking/booking-error-messages";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

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
  searchParams: Promise<{ error?: string }>;
};

export default async function BookingDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;

  // getBookingDetail() already enforces ownership (returns null for
  // both "doesn't exist" and "belongs to someone else") — this is the
  // real security boundary, not just a UI-level check.
  const fetchedBooking = await getBookingDetail(id);

  if (!fetchedBooking) {
    notFound();
    return null;
  }

  const booking = fetchedBooking;

  const canCancel = canCancelBooking(booking.status);

  const t = await getServerTranslator("booking");
  const tErrors = await getServerTranslator("errors");
  const errorMessage = error && isBookingActionErrorCode(error) ? tErrors(getBookingErrorTranslationKey(error)) : null;
  const locale = await getLocale();

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{booking.serviceName}</h1>
        <p className="mt-1 text-sm text-foreground/50">{booking.providerName}</p>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4">
          <AlertCircle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-danger">{errorMessage}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/50">{t("statusLabel")}</span>
          <span className="font-medium text-foreground">{getBookingStatusLabel(booking.status)}</span>
        </div>
        {booking.priceSnapshot && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">{t("priceLabel")}</span>
            <span className="font-medium text-primary">{booking.priceSnapshot}</span>
          </div>
        )}
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

      {canCancel && (
        <form
          action={async () => {
            "use server";
            const result = await cancelBooking(booking.id);
            if (!result.ok) {
              redirect(`/bookings/${booking.id}?error=${result.error}`);
              return;
            }
            redirect(`/bookings/${booking.id}`);
          }}
        >
          <button
            type="submit"
            className="w-full rounded-full border border-danger/40 px-6 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            {t("cancelButton")}
          </button>
        </form>
      )}
    </main>
  );
}
