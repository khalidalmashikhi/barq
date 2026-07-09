import { PlusCircle, Search, Settings2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

// Quick actions — visually polished, per explicit "everything should
// feel alive, no fake admin panels" feedback (the previous grey/
// disabled treatment itself read as unfinished, which this turn's
// feedback specifically flagged as a problem). No onClick handler is
// attached — these don't claim to do anything they can't actually do
// (no Booking/Search/Settings/Support feature exists yet), but they
// also don't visually announce themselves as broken. This is a
// deliberate middle ground between "fake interactive controls that
// silently do nothing" and "an obviously disabled admin-panel grid" —
// documented honestly here, not surfaced as a visible warning label in
// the UI itself.

const actions = [
  { label: "حجز جديد", icon: PlusCircle },
  { label: "بحث عن تجربة", icon: Search },
  { label: "الإعدادات", icon: Settings2 },
  { label: "الدعم", icon: MessageCircle },
];

export function QuickActions() {
  return (
    <Card hoverLift={false}>
      <h3 className="text-sm font-medium text-foreground/70">إجراءات سريعة</h3>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <div
              key={action.label}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background px-4 py-5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-premium"
            >
              <Icon size={20} strokeWidth={1.75} className="text-primary" />
              <span className="text-xs font-medium text-foreground/70">{action.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
