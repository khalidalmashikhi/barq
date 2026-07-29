import type { LucideIcon } from "lucide-react";
import { clsx } from "@/components/ui/clsx";

// KPI card — Phase F.3 (Provider Dashboard). Distinct from the
// existing, smaller `StatCard` (glass, compact, used for the 6-count
// grid already on this page): this is the larger, primary-metric card
// for the new KPI row — bigger value type, an optional tone (for
// completion/cancellation rates, where color genuinely communicates
// good/bad), and an optional real `helpText` (e.g. "18 of 24
// bookings") rather than a fabricated trend arrow. `StatCard`'s own
// `trend` prop is intentionally still unused here and elsewhere — no
// current query computes a period-over-period delta, so nothing
// invents one.

type KpiCardTone = "default" | "success" | "danger";

type KpiCardProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  helpText?: string;
  tone?: KpiCardTone;
};

const TONE_ICON_CLASSES: Record<KpiCardTone, string> = {
  default: "bg-accent/15 text-primary",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
};

const TONE_VALUE_CLASSES: Record<KpiCardTone, string> = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
};

export function KpiCard({ label, value, icon: Icon, helpText, tone = "default" }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-premium">
      <span className={clsx("flex h-10 w-10 items-center justify-center rounded-xl", TONE_ICON_CLASSES[tone])}>
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className={clsx("text-2xl font-semibold", TONE_VALUE_CLASSES[tone])}>{value}</span>
        <span className="text-xs text-foreground/50">{label}</span>
      </div>
      {helpText && <span className="text-xs text-foreground/40">{helpText}</span>}
    </div>
  );
}
