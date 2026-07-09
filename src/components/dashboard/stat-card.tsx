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
};

export function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/40 bg-glass px-4 py-3.5 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-primary">
        <Icon size={16} strokeWidth={1.75} />
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-semibold text-foreground">{value}</span>
        <span className="text-xs text-foreground/50">{label}</span>
      </div>
      {trend && <span className="ms-auto text-xs text-success">{trend}</span>}
    </div>
  );
}
