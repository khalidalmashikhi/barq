import Link from "next/link";
import { Search } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { clsx } from "@/components/ui/clsx";

// My Bookings filters — Phase F.2 (goal 6: Filters, Search, Upcoming
// vs Past). Search is a plain GET form (same URL-is-the-state-machine
// convention as ProviderBookingFilters/ServiceFilters). The Upcoming/
// Past/All segment is deliberately plain links styled like tabs, not
// the interactive Tabs component — Tabs manages its own client-side
// state, which would break the "filter state lives in the URL,
// shareable/bookmarkable" pattern every other filtered list in this
// app already relies on.

type CustomerBookingFiltersProps = {
  basePath: string;
  currentSearch?: string;
  currentWhen?: "upcoming" | "past";
};

export async function CustomerBookingFilters({ basePath, currentSearch, currentWhen }: CustomerBookingFiltersProps) {
  const t = await getServerTranslator("booking");

  function hrefFor(when?: "upcoming" | "past"): string {
    const params = new URLSearchParams();
    if (currentSearch) params.set("q", currentSearch);
    if (when) params.set("when", when);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const segments: Array<{ key: string; when?: "upcoming" | "past"; label: string }> = [
    { key: "all", when: undefined, label: t("filterAllLabel") },
    { key: "upcoming", when: "upcoming", label: t("filterUpcomingLabel") },
    { key: "past", when: "past", label: t("filterPastLabel") },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="inline-flex w-fit items-center gap-1 rounded-xl bg-accent/10 p-1">
        {segments.map((segment) => {
          const isActive = segment.when === currentWhen;
          return (
            <Link
              key={segment.key}
              href={hrefFor(segment.when)}
              aria-current={isActive ? "page" : undefined}
              className={clsx(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150",
                isActive ? "bg-card text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
              )}
            >
              {segment.label}
            </Link>
          );
        })}
      </div>

      <form method="get" className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:w-72">
        {currentWhen && <input type="hidden" name="when" value={currentWhen} />}
        <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
        <input
          type="search"
          name="q"
          defaultValue={currentSearch}
          placeholder={t("searchBookingsPlaceholder")}
          aria-label={t("searchBookingsPlaceholder")}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
      </form>
    </div>
  );
}
