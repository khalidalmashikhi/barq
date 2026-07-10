import { notFound, redirect } from "next/navigation";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { cancelBooking } from "@/lib/booking/cancel-booking";

const statusLabels: Record<string, string> = {
  CREATED: "قيد الانتظار",
  CONFIRMED: "مؤكد",
  IN_PROGRESS: "جارٍ",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
  DISPUTED: "قيد المراجعة",
};

const CANCELLABLE_STATUSES = ["CREATED", "CONFIRMED"];

type Props = {
  params: Promise<{ id: string }>;
};

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params;

  // getBookingDetail() already enforces ownership (returns null for
  // both "doesn't exist" and "belongs to someone else") — this is the
  // real security boundary, not just a UI-level check.
  const fetchedBooking = await getBookingDetail(id);

  if (!fetchedBooking) {
    notFound();
    return null;
  }

  const booking = fetchedBooking;

  const canCancel = CANCELLABLE_STATUSES.includes(booking.status);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{booking.serviceName}</h1>
        <p className="mt-1 text-sm text-foreground/50">{booking.providerName}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/50">الحالة</span>
          <span className="font-medium text-foreground">{statusLabels[booking.status] ?? booking.status}</span>
        </div>
        {booking.priceSnapshot && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">السعر</span>
            <span className="font-medium text-primary">{booking.priceSnapshot}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/50">تاريخ الطلب</span>
          <span className="font-medium text-foreground">
            {new Date(booking.createdAt).toLocaleDateString("ar-OM", { day: "numeric", month: "long", year: "numeric" })}
          </span>
        </div>
      </div>

      {canCancel && (
        <form
          action={async () => {
            "use server";
            await cancelBooking(booking.id);
            redirect(`/bookings/${booking.id}`);
          }}
        >
          <button
            type="submit"
            className="w-full rounded-full border border-danger/40 px-6 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            إلغاء الحجز
          </button>
        </form>
      )}
    </main>
  );
}
