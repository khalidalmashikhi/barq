import type { LucideIcon } from "lucide-react";
import type { CurrencyAmount } from "@/lib/provider/queries/get-provider-earnings";

// Earnings metric card — Provider Billing & Earnings Foundation.
//
// MULTI-CURRENCY, NEVER MERGED: renders exactly one line per currency
// in `amounts` — never a single collapsed figure. Real production data
// is single-currency (OMR) today, so in practice this renders one
// line, but the component makes no assumption about that: if a
// provider's data ever spans two currencies, both render as separate
// rows here, never summed or converted.
//
// EMPTY IS HONEST, NOT ZERO: an empty `amounts` array renders
// `emptyLabel` (e.g. "No completed bookings yet") rather than a
// fabricated "0.00" — matching this codebase's established
// null-over-zero convention (see get-provider-metrics.ts's own
// completionRate/cancellationRate comment).

type EarningsMetricCardProps = {
  label: string;
  icon: LucideIcon;
  amounts: CurrencyAmount[];
  emptyLabel: string;
  helpText?: string;
};

export function EarningsMetricCard({ label, icon: Icon, amounts, emptyLabel, helpText }: EarningsMetricCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-premium">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-primary">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        {amounts.length === 0 ? (
          <span className="text-sm text-foreground/40">{emptyLabel}</span>
        ) : (
          amounts.map((entry) => (
            <span key={entry.currency} className="text-2xl font-semibold text-foreground">
              {entry.amount} <span className="text-base font-medium text-foreground/50">{entry.currency}</span>
            </span>
          ))
        )}
        <span className="text-xs text-foreground/50">{label}</span>
      </div>
      {helpText && <span className="text-xs text-foreground/40">{helpText}</span>}
    </div>
  );
}
