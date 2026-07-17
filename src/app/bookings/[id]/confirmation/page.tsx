import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Booking confirmation page — Engineering Sprint (Booking Engine).
//
// COPY DELIBERATELY SAYS "request received," not "booking confirmed" —
// the actual BookingStatus is CREATED, not CONFIRMED, since no payment/
// confirmation step exists in this sprint. Saying "confirmed" here
// would misrepresent the real status shown one click away on the
// detail page — a real status/copy mismatch this page specifically
// avoids.

type Props = {
  params: Promise<{ id: string }>;
};

export default async function BookingConfirmationPage({ params }: Props) {
  const { id } = await params;
  const fetchedBooking = await getBookingDetail(id);

  if (!fetchedBooking) {
    notFound();
    return null;
  }

  const booking = fetchedBooking;
  const t = await getServerTranslator("booking");
  const locale = await getLocale();

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
      <CheckCircle2 size={40} strokeWidth={1.5} className="text-success" />
      <h1 className="text-xl font-semibold text-foreground">{t("confirmationReceivedTitle")}</h1>
      <p className="text-sm text-foreground/60">
        {booking.serviceName} — {booking.providerName}
      </p>
      {booking.priceSnapshot && (
        <p className="text-lg font-semibold text-primary">{booking.priceSnapshot}</p>
      )}
      {booking.slotStartTime && (
        <p className="text-sm text-foreground/60">
          {formatDate(new Date(booking.slotStartTime), locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {" — "}
          {booking.seats} {t("seatsSuffixLabel")}
        </p>
      )}
      <p className="text-xs text-foreground/40">{t("confirmationNoticeText")}</p>
      <Link
        href={`/bookings/${booking.id}`}
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("viewDetailsButton")}
      </Link>
    </main>
  );
}
