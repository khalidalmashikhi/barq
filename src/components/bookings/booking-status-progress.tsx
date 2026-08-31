import { clsx } from "@/components/ui/clsx";

// Compact per-card status progress — Phase F.2 (goal 6, My Bookings
// list "Timeline" item). Distinct from BookingTimeline (the full,
// real BookingStatusEvent history shown on the booking DETAIL page) —
// this only reflects the booking's CURRENT status, avoiding an N+1
// getBookingTimeline() query per row on a paginated list.

const HAPPY_PATH = ["CREATED", "PENDING_PROVIDER", "CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const;

type BookingStatusProgressProps = {
  status: string;
};

export function BookingStatusProgress({ status }: BookingStatusProgressProps) {
  // CUSTOMER JOURNEY VISIBILITY — every negative-terminal outcome renders the same way (danger
  // bars), never the empty/gray "not started yet" look. EXPIRED was previously absent here, so it
  // fell through to currentIndex = -1 and rendered all-empty, misleadingly implying an unstarted
  // active journey for a booking that is actually over.
  const isTerminalException =
    status === "CANCELLED" || status === "REJECTED" || status === "DISPUTED" || status === "EXPIRED";
  const currentIndex = HAPPY_PATH.indexOf(status as (typeof HAPPY_PATH)[number]);

  return (
    <div className="flex items-center gap-1" aria-hidden>
      {HAPPY_PATH.map((step, index) => (
        <span
          key={step}
          className={clsx(
            "h-1 flex-1 rounded-full",
            isTerminalException
              ? "bg-danger/20"
              : index <= currentIndex
                ? "bg-primary"
                : "bg-accent/20"
          )}
        />
      ))}
    </div>
  );
}
