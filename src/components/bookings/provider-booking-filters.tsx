import { Search } from "lucide-react";
import { getBookingStatusLabel } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Provider booking filters — Provider Dashboard Phase 1c.
//
// Placed under the Bookings bounded context (src/components/bookings/),
// not src/components/provider/, per explicit instruction — this filter
// concerns Booking data/status, not a Provider-specific UI concept.
// Same established GET-form convention as
// src/components/provider/service-filters.tsx and
// src/components/services/service-filters.tsx: a plain GET form, no
// client JS, search/filter state lives entirely in the URL.
//
// NO SORT CONTROL: only one sort ("newest") is supported this phase,
// per explicit instruction — a dropdown with a single meaningful
// option would be a pointless control this project's own conventions
// already avoid elsewhere (see get-provider-bookings.ts's own note).
// Reuses provider.serviceStatusAll ("All Statuses"),
// provider.applyFiltersButton ("Apply Filters"), and
// provider.searchByServiceNamePlaceholder directly rather than
// duplicating identical-meaning keys for a second filter form.

const STATUSES = ["CREATED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DISPUTED"] as const;

type ProviderBookingFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
};

export async function ProviderBookingFilters({ currentSearch, currentStatus }: ProviderBookingFiltersProps) {
  const t = await getServerTranslator("provider");

  return (
    <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5">
        <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
        <input
          type="search"
          name="q"
          defaultValue={currentSearch}
          placeholder={t("searchByServiceNamePlaceholder")}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
      </div>

      <select
        name="status"
        defaultValue={currentStatus ?? ""}
        className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none sm:w-56"
      >
        <option value="">{t("serviceStatusAll")}</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {getBookingStatusLabel(status)}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("applyFiltersButton")}
      </button>
    </form>
  );
}
