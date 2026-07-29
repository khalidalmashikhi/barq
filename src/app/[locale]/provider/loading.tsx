import { Skeleton } from "@/components/ui/skeleton";

// Phase F.3 — replaces the generic AppShellContentLoading with a
// skeleton shaped specifically like the redesigned Dashboard (hero +
// KPI row + stat row + two preview lists + two summary cards +
// activity), so there is no layout shift once real data replaces it.
// Other Provider routes (Services/Bookings/Availability/Notifications)
// keep the generic content skeleton — their filters+list shape still
// matches it well; only the Dashboard's shape changed enough this
// phase to warrant its own.

export default function ProviderOverviewLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
      <Skeleton className="h-36 w-full rounded-3xl" />

      <div>
        <Skeleton className="mb-3 h-4 w-40" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>

      <Skeleton className="h-48 w-full" />
    </div>
  );
}
