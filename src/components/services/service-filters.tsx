import { Search } from "lucide-react";

// Service filters — Engineering Sprint (Services Marketplace).
//
// NO category or governorate control here, deliberately — building
// disabled/fake controls for fields that don't exist would be worse
// than omitting them; see get-services.ts's own note on why. A plain
// GET form (no client JS) so search/filter state lives entirely in the
// URL — real server-side filtering, shareable/bookmarkable URLs, no
// client-side state duplication.

type ServiceFiltersProps = {
  providers: Array<{ id: string; name: string }>;
  currentSearch?: string;
  currentProviderId?: string;
  currentMinPrice?: string;
  currentMaxPrice?: string;
  currentSort?: string;
};

export function ServiceFilters({
  providers,
  currentSearch,
  currentProviderId,
  currentMinPrice,
  currentMaxPrice,
  currentSort,
}: ServiceFiltersProps) {
  return (
    <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5">
        <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
        <input
          type="search"
          name="q"
          defaultValue={currentSearch}
          placeholder="ابحث عن تجربة..."
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input
          type="number"
          name="minPrice"
          defaultValue={currentMinPrice}
          placeholder="أدنى سعر"
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <input
          type="number"
          name="maxPrice"
          defaultValue={currentMaxPrice}
          placeholder="أعلى سعر"
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <select
          name="providerId"
          defaultValue={currentProviderId ?? ""}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
        >
          <option value="">كل المزودين</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={currentSort ?? "newest"}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
        >
          <option value="newest">الأحدث</option>
          <option value="price_asc">السعر: من الأقل</option>
          <option value="price_desc">السعر: من الأعلى</option>
        </select>
      </div>

      <button
        type="submit"
        className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        تطبيق الفلاتر
      </button>
    </form>
  );
}
