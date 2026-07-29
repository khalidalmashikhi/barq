import Link from "next/link";
import { Search, X } from "lucide-react";
import { getAvailabilityStateTranslationKey } from "@/lib/admin/presentation/availability-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Availability admin filters — Phase 2.8 (Availability Admin UI).
// Mirrors service-filters.tsx exactly: plain GET-form, no client JS,
// real removable filter chips. Unlike price-filters.tsx (which had to
// fall back to exact Service ID search since Price has no name field),
// Availability's own admin query already supports a real bilingual
// service-name search (getAvailabilitySlots()'s `q` parameter, reusing
// the identical JSON-path strategy already proven in
// get-provider-availability.ts) — so "Search" here works the same way
// Provider/Service's own search does, not the Price workaround.

const AVAILABILITY_STATES = ["OPEN", "BLOCKED", "CANCELLED"] as const;

type AvailabilityFiltersProps = {
  currentSearch?: string;
  currentState?: string;
};

export async function AvailabilityFilters({ currentSearch, currentState }: AvailabilityFiltersProps) {
  const t = await getServerTranslator("admin");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/admin/availability", locale });

  function hrefWithout(...keys: string[]): string {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = { q: currentSearch, state: currentState };
    for (const [key, value] of Object.entries(current)) {
      if (value && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips: Array<{ key: string; label: string; href: string }> = [];
  if (currentSearch) chips.push({ key: "q", label: `"${currentSearch}"`, href: hrefWithout("q") });
  if (currentState) {
    chips.push({ key: "state", label: t(getAvailabilityStateTranslationKey(currentState)), href: hrefWithout("state") });
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
          <input
            type="search"
            name="q"
            defaultValue={currentSearch}
            placeholder={t("availabilitySearchPlaceholder")}
            aria-label={t("availabilitySearchPlaceholder")}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
        </div>

        <label className="flex flex-col gap-1.5 sm:w-64">
          <span className="text-xs font-medium text-foreground/50">{t("availabilityStatusAll")}</span>
          <select
            name="state"
            defaultValue={currentState ?? ""}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">{t("availabilityStatusAll")}</option>
            {AVAILABILITY_STATES.map((state) => (
              <option key={state} value={state}>
                {t(getAvailabilityStateTranslationKey(state))}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("applyAvailabilityFiltersButton")}
        </button>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground/40">{t("categoryActiveFiltersLabel")}</span>
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
            {t("categoryClearAllFiltersLabel")}
          </Link>
        </div>
      )}
    </div>
  );
}
