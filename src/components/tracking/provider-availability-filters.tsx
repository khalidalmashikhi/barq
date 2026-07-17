import { Search } from "lucide-react";
import { getAvailabilityStateLabel } from "@/lib/tracking/presentation/availability-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Provider availability filters — Provider Dashboard Phase 1d.
//
// Placed under the Tracking bounded context
// (src/components/tracking/), not Services or Provider, per explicit
// instruction — Availability is a Tracking-context concept. Same
// established GET-form convention as
// src/components/bookings/provider-booking-filters.tsx and
// src/components/provider/service-filters.tsx: a plain GET form, no
// client JS, search/filter state lives entirely in the URL.
//
// NO SORT CONTROL, NO SCOPE CONTROL: only "upcoming" is supported this
// phase (no past/history/all toggle), and only one sort order exists
// — both per explicit instruction. Reuses
// provider.serviceStatusAll ("All Statuses"),
// provider.applyFiltersButton ("Apply Filters"), and
// provider.searchByServiceNamePlaceholder directly rather than
// duplicating identical-meaning keys for a third filter form.

const STATES = ["OPEN", "BLOCKED", "CANCELLED"] as const;

type ProviderAvailabilityFiltersProps = {
  currentSearch?: string;
  currentState?: string;
};

export async function ProviderAvailabilityFilters({ currentSearch, currentState }: ProviderAvailabilityFiltersProps) {
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
        name="state"
        defaultValue={currentState ?? ""}
        className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none sm:w-56"
      >
        <option value="">{t("serviceStatusAll")}</option>
        {STATES.map((state) => (
          <option key={state} value={state}>
            {getAvailabilityStateLabel(state)}
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
