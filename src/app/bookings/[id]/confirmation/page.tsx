import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";

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

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
      <CheckCircle2 size={40} strokeWidth={1.5} className="text-success" />
      <h1 className="text-xl font-semibold text-foreground">تم استلام طلب الحجز</h1>
      <p className="text-sm text-foreground/60">
        {booking.serviceName} — {booking.providerName}
      </p>
      {booking.priceSnapshot && (
        <p className="text-lg font-semibold text-primary">{booking.priceSnapshot}</p>
      )}
      <p className="text-xs text-foreground/40">
        سيتم إشعارك عند تأكيد الحجز من قبل مزود الخدمة.
      </p>
      <Link
        href={`/bookings/${booking.id}`}
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        عرض تفاصيل الحجز
      </Link>
    </main>
  );
}
