import { Search } from "lucide-react";
import { getServiceStatusLabel } from "@/lib/services/presentation/service-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Provider service filters — Provider Dashboard Phase 1b.
//
// Same established convention as src/components/services/service-filters.tsx:
// a plain GET form, no client JS — search/filter/sort state lives
// entirely in the URL, real server-side filtering, shareable/
// bookmarkable URLs. Not a shared component with the public one, since
// the status filter here is Provider-management-specific (the public
// page has no such concept — it only ever shows PUBLISHED services).

const STATUSES = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"] as const;

type ProviderServiceFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
  currentSort?: string;
};

export async function ProviderServiceFilters({ currentSearch, currentStatus, currentSort }: ProviderServiceFiltersProps) {
  const t = await getServerTranslator("provider");

  return (
    <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5">
        <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
        <input
          type="search"
          name="q"
          defaultValue={currentSearch}
          placeholder={t("servicesSearchPlaceholder")}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <select
          name="status"
          defaultValue={currentStatus ?? ""}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
        >
          <option value="">{t("serviceStatusAll")}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {getServiceStatusLabel(status)}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={currentSort ?? "newest"}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
        >
          <option value="newest">{t("sortNewest")}</option>
          <option value="price_asc">{t("sortPriceAsc")}</option>
          <option value="price_desc">{t("sortPriceDesc")}</option>
        </select>
      </div>

      <button
        type="submit"
        className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("applyFiltersButton")}
      </button>
    </form>
  );
}
