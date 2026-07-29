import { Flame } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { ProviderCapacityAlertItem } from "@/lib/provider/queries/get-provider-overview";

// Capacity Alerts — Phase 4.2 (Provider Experience, Priority 4:
// Dashboard). Real, computed rows only (bookedCount >= capacity on an
// upcoming OPEN slot, see get-provider-overview.ts) — renders nothing
// at all when the array is empty, rather than an empty-state card, per
// "surface actionable information only": a provider with no sold-out
// slots has nothing to act on here, so this section simply doesn't
// appear (distinct from the other dashboard lists, which always show
// an empty state — this one is opt-in visibility, not a fixed slot on
// the page).

type CapacityAlertsProps = {
  items: ProviderCapacityAlertItem[];
  availabilityHref: string;
};

export async function CapacityAlerts({ items, availabilityHref }: CapacityAlertsProps) {
  if (items.length === 0) {
    return null;
  }

  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  return (
    <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-accent-foreground">
        <Flame size={16} strokeWidth={1.75} />
        {t("capacityAlertsTitle")}
      </h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm">
            <div className="flex flex-col gap-0.5">
              <Link
                href={availabilityHref}
                className="rounded font-medium text-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {item.serviceName}
              </Link>
              <span className="text-xs text-foreground/40">
                {formatDate(item.startTime, locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <span className="shrink-0 rounded-full bg-accent/20 px-2.5 py-1 text-xs font-medium text-accent-foreground">
              {t("capacityAlertFullLabel", { capacity: item.capacity })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
