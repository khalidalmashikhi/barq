import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking/get-my-bookings";

const statusLabels: Record<string, string> = {
  CREATED: "قيد الانتظار",
  CONFIRMED: "مؤكد",
  IN_PROGRESS: "جارٍ",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
  DISPUTED: "قيد المراجعة",
};

const statusStyles: Record<string, string> = {
  CREATED: "bg-accent/20 text-accent-foreground",
  CONFIRMED: "bg-success/10 text-success",
  IN_PROGRESS: "bg-secondary/15 text-secondary",
  COMPLETED: "bg-primary/10 text-primary",
  CANCELLED: "bg-danger/10 text-danger",
  DISPUTED: "bg-danger/10 text-danger",
};

export default async function BookingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  const bookings = await getMyBookings();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">حجوزاتي</h1>

      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <CalendarX size={32} strokeWidth={1.5} className="text-foreground/25" />
          <p className="text-foreground/60">لا توجد حجوزات بعد</p>
          <Link
            href="/services"
            className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            تصفح التجارب
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <Link
              key={booking.id}
              href={`/bookings/${booking.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-premium"
            >
              <div>
                <p className="font-medium text-foreground">{booking.serviceName}</p>
                <p className="mt-0.5 text-xs text-foreground/40">
                  {new Date(booking.createdAt).toLocaleDateString("ar-OM", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {booking.priceSnapshot && (
                  <span className="text-sm font-semibold text-primary">{booking.priceSnapshot}</span>
                )}
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusStyles[booking.status] ?? "bg-accent/20 text-accent-foreground"}`}>
                  {statusLabels[booking.status] ?? booking.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
