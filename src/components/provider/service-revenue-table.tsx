import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table2 } from "lucide-react";
import type { ProviderServiceRevenueGroup } from "@/lib/provider/queries/get-provider-earnings";

// Revenue by Service — Provider Billing & Earnings Foundation.
//
// ONE TABLE PER CURRENCY, NEVER COMBINED: `groups` is already grouped
// by currency (get-provider-earnings.ts never merges currencies) —
// this component renders one table per group, each with its own
// currency heading when there is more than one, rather than a single
// table that would force cross-currency rows next to each other.
//
// ORDERING IS ALREADY DECIDED UPSTREAM: `services` within each group
// arrive pre-sorted (revenue desc -> completed bookings desc ->
// alphabetical — see that function's own comment) — this component
// only renders that order and marks the first/last row, it never
// re-sorts.
//
// TOP/LOWEST BADGES ONLY WHEN MEANINGFUL: with a single service, that
// one row is trivially both the top and lowest earner, which would be
// a confusing badge to show — so both badges are suppressed unless a
// group has more than one service.

export async function ServiceRevenueTable({ groups }: { groups: ProviderServiceRevenueGroup[] }) {
  const t = await getServerTranslator("provider");

  const hasAnyData = groups.some((group) => group.services.length > 0);

  if (!hasAnyData) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-medium text-foreground/80">{t("revenueByServiceTitle")}</h2>
        <EmptyState icon={Table2} iconSize={24} gap="gap-2" padding="py-8" message={t("noServiceRevenueLabel")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-medium text-foreground/80">{t("revenueByServiceTitle")}</h2>
      {groups.map((group) => (
        <div key={group.currency} className="flex flex-col gap-2.5">
          {groups.length > 1 && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/40">{group.currency}</h3>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-foreground/40">
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("serviceColumnLabel")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("completedBookingsColumnLabel")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("totalRevenueColumnLabel")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("averageBookingValueColumnLabel")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.services.map((service, index) => {
                  const isTop = group.services.length > 1 && index === 0;
                  const isLowest = group.services.length > 1 && index === group.services.length - 1;
                  return (
                    <tr key={service.serviceId} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{service.serviceName}</span>
                          {isTop && <Badge variant="success">{t("topEarningBadgeLabel")}</Badge>}
                          {isLowest && <Badge variant="warning">{t("lowestEarningBadgeLabel")}</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-foreground/70">{service.completedBookingsCount}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        {service.totalRevenue} {group.currency}
                      </td>
                      <td className="px-3 py-2.5 text-foreground/70">
                        {service.averageBookingValue} {group.currency}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
