import { Card } from "@/components/ui/card";
import { clsx } from "@/components/ui/clsx";

// Upcoming bookings timeline — Card content is not wired to a real
// Booking data model (none exists in this project yet). Per this
// turn's explicit request that the interface itself look finished
// rather than visibly "placeholder," no warning label is rendered in
// the UI — the honesty lives here, in code, for the next engineer, not
// as user-visible text undermining the premium feel this turn asked for.

const bookings = [
  { title: "جولة في الجبل الأخضر", date: "12 يوليو", status: "مؤكد" },
  { title: "رحلة صحراء الشرقية", date: "18 يوليو", status: "قيد الانتظار" },
  { title: "غوص في مسندم", date: "25 يوليو", status: "مؤكد" },
];

const statusStyles: Record<string, string> = {
  مؤكد: "bg-success/10 text-success",
  "قيد الانتظار": "bg-accent/20 text-accent-foreground",
};

export function RecentBookingsTimeline() {
  return (
    <Card hoverLift={false}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>📅</span>
        حجوزاتي القادمة
      </h2>

      <ol className="relative mt-6 flex flex-col gap-6 border-s border-border ps-6">
        {bookings.map((booking) => (
          <li key={booking.title} className="relative">
            <span className="absolute -start-[1.65rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{booking.title}</p>
                <p className="mt-0.5 text-xs text-foreground/40">{booking.date}</p>
              </div>
              <span
                className={clsx(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
                  statusStyles[booking.status]
                )}
              >
                {booking.status}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
