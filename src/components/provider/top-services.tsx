import { TrendingUp } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProviderTopService } from "@/lib/provider/queries/get-provider-metrics";

// Service performance — Phase F.3 (Provider Dashboard). Real ranking
// by booking count (Booking.groupBy on serviceId) — no rating/revenue
// -per-service breakdown is computed here since neither is cheap to
// add correctly in the time this phase allows; booking count is a
// real, honest measure of "which service performs" on its own.

type TopServicesProps = {
  items: ProviderTopService[];
};

export async function TopServices({ items }: TopServicesProps) {
  const t = await getServerTranslator("provider");

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground/80">
        <TrendingUp size={16} strokeWidth={1.75} />
        {t("servicePerformanceTitle")}
      </h2>

      {items.length === 0 ? (
        <EmptyState icon={TrendingUp} iconSize={22} gap="gap-1.5" padding="py-6" message={t("noServicePerformanceLabel")} messageClassName="text-sm text-foreground/50" />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {items.map((service, index) => (
            <li key={service.serviceId} className="flex items-center gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-primary">
                {index + 1}
              </span>
              <Link
                href={`/provider/services/${service.serviceId}`}
                className="flex-1 truncate rounded text-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {service.serviceName}
              </Link>
              <span className="shrink-0 text-xs text-foreground/50">{t("bookingsCountSuffix", { count: service.bookingsCount })}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
