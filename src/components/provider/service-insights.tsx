import { AlertTriangle, TrendingDown, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { ProviderServiceInsightItem } from "@/lib/provider/queries/get-provider-service-insights";

// Services Needing Attention — Provider Analytics & Business Insights.
//
// Two real, independently-computed signals (see
// get-provider-service-insights.ts) rendered as one compact widget,
// each row tagged with its specific reason rather than merged into an
// undifferentiated list — a provider needs to know WHY a service is
// flagged (no bookable slots vs. no bookings at all) to know what
// action to take. Renders nothing (a single positive empty state)
// when both lists are empty, matching CapacityAlerts' own "opt-in
// visibility" convention (no empty section for a healthy catalog).

type ServiceInsightsProps = {
  needingAttention: ProviderServiceInsightItem[];
  lowActivity: ProviderServiceInsightItem[];
};

export async function ServiceInsights({ needingAttention, lowActivity }: ServiceInsightsProps) {
  const t = await getServerTranslator("provider");

  const hasAnyInsight = needingAttention.length > 0 || lowActivity.length > 0;

  return (
    <Card hoverLift={false}>
      <h2 className="text-lg font-semibold text-foreground">{t("servicesNeedingAttentionTitle")}</h2>

      {!hasAnyInsight ? (
        <div className="mt-6">
          <EmptyState icon={CheckCircle2} message={t("noServiceInsightsLabel")} padding="py-8" />
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2.5">
          {needingAttention.map((item) => (
            <li key={`attention-${item.id}`}>
              <Link
                href={`/provider/services/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <span className="truncate font-medium text-foreground">{item.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[0.65rem] font-semibold text-danger">
                  <AlertTriangle size={11} strokeWidth={2} />
                  {t("noUpcomingAvailabilityLabel")}
                </span>
              </Link>
            </li>
          ))}
          {lowActivity.map((item) => (
            <li key={`low-activity-${item.id}`}>
              <Link
                href={`/provider/services/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <span className="truncate font-medium text-foreground">{item.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[0.65rem] font-semibold text-accent-foreground">
                  <TrendingDown size={11} strokeWidth={2} />
                  {t("lowActivityReasonLabel")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
