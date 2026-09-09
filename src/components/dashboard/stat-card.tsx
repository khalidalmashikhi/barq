import type { LucideIcon } from "lucide-react";

// Stat card — reduced size, glass treatment, per explicit "smaller,
// more elegant, glass cards" instruction. No longer uses the shared
// Card component's solid-white treatment — this is a deliberate visual
// exception for this one context, not a change to Card itself (Card is
// still used everywhere else as-is).

type StatCardProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
  // ADMIN MOBILE POLISH (§2/§9) — "lg" makes the VALUE dominant for primary KPIs; the
  // default "md" is byte-for-byte the previous look, so every existing caller (the customer
  // dashboard included) is unchanged. The icon supports the metric, it never dominates it.
  size?: "md" | "lg";
};

export function StatCard({ label, value, icon: Icon, trend, size = "md" }: StatCardProps) {
  const lg = size === "lg";
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-white/40 bg-glass px-4 shadow-sm ${lg ? "py-4" : "py-3.5"}`}>
      <div className={`flex shrink-0 items-center justify-center rounded-lg bg-accent/20 text-primary ${lg ? "h-10 w-10" : "h-9 w-9"}`}>
        <Icon size={lg ? 18 : 16} strokeWidth={1.75} />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className={`font-semibold text-foreground ${lg ? "text-2xl leading-tight" : "text-lg"}`}>{value}</span>
        {/* Fixed KPI labels are known copy, not user content — wrap naturally (max 2 lines),
            never truncate mid-word. line-clamp-2 caps height so cards stay aligned/compact. */}
        <span className="line-clamp-2 text-xs leading-snug text-foreground/70">{label}</span>
      </div>
      {trend && <span className="ms-auto text-xs text-success">{trend}</span>}
    </div>
  );
}
