import Link from "next/link";
import { Search, X } from "lucide-react";
import { getBookingStatusLabel } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Provider booking filters — Provider Dashboard Phase 1c; Phase F.3
// visual + active-filters pass (mirrors the Provider Services/
// Availability filters redesign — labeled field, real removable
// filter chips, same plain GET-form/no-client-JS architecture).
//
// Placed under the Bookings bounded context (src/components/bookings/),
// not src/components/provider/, per explicit instruction — this filter
// concerns Booking data/status, not a Provider-specific UI concept.
//
// NO SORT CONTROL: only one sort ("newest") is supported this phase,
// per explicit instruction, unchanged.

const STATUSES = [
  "CREATED",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DISPUTED",
  "EXPIRED",
] as const;

type ProviderBookingFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
};

export async function ProviderBookingFilters({ currentSearch, currentStatus }: ProviderBookingFiltersProps) {
  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/provider/bookings", locale });

  function hrefWithout(...keys: string[]): string {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = { q: currentSearch, status: currentStatus };
    for (const [key, value] of Object.entries(current)) {
      if (value && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips: Array<{ key: string; label: string; href: string }> = [];
  if (currentSearch) chips.push({ key: "q", label: `"${currentSearch}"`, href: hrefWithout("q") });
  if (currentStatus) chips.push({ key: "status", label: getBookingStatusLabel(currentStatus, tBooking), href: hrefWithout("status") });

  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
          <input
            type="search"
            name="q"
            defaultValue={currentSearch}
            placeholder={t("searchByServiceNamePlaceholder")}
            aria-label={t("searchByServiceNamePlaceholder")}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
        </div>

        <label className="flex flex-col gap-1.5 sm:w-56">
          <span className="text-xs font-medium text-foreground/50">{t("serviceStatusAll")}</span>
          <select
            name="status"
            defaultValue={currentStatus ?? ""}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">{t("serviceStatusAll")}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {getBookingStatusLabel(status, tBooking)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("applyFiltersButton")}
        </button>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground/40">{t("activeFiltersLabel")}</span>
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {chip.label}
              <X size={12} strokeWidth={2} />
            </Link>
          ))}
          <Link href={basePath} className="text-xs font-medium text-foreground/40 underline-offset-2 hover:text-foreground/60 hover:underline">
            {t("clearAllFiltersLabel")}
          </Link>
        </div>
      )}
    </div>
  );
}
