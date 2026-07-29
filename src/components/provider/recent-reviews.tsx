import { Star, MessageSquareText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import type { ProviderReviewItem } from "@/lib/provider/queries/get-provider-reviews-summary";

// Recent Reviews — Provider Analytics & Business Insights. Mirrors
// ProviderRecentActivity's Card + EmptyState + short-list shape
// exactly (max 5, read-only, no actions) — the same established
// dashboard-widget pattern, not a new one. Shows which service was
// reviewed (not a customer label — see get-provider-reviews-summary.ts's
// own note on why: no customer name field exists on User/Customer, and
// "which of my services" is more operationally useful to a provider
// than a repeated generic placeholder on every row).

type RecentReviewsProps = {
  items: ProviderReviewItem[];
};

export async function RecentReviews({ items }: RecentReviewsProps) {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();

  return (
    <Card hoverLift={false}>
      <h2 className="text-lg font-semibold text-foreground">{t("recentReviewsTitle")}</h2>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={MessageSquareText} message={t("noReviewsYetLabel")} padding="py-8" />
        </div>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-foreground">{item.serviceName}</p>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent-foreground">
                  <Star size={13} strokeWidth={1.75} className="text-accent" fill="currentColor" />
                  {item.rating.toFixed(1)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{item.content}</p>
              <p className="mt-1 text-xs text-foreground/40">
                {formatDate(item.createdAt, locale, { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
