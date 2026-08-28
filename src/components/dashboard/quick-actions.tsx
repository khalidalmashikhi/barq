import { Compass, CalendarCheck, CreditCard, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Quick actions — Customer Experience Polish. These are now REAL shortcuts to
// existing customer destinations (services catalogue, bookings, payments,
// settings), each a working link — not the former inert, handler-less tiles.
// Every href points at a route that actually exists.

export async function QuickActions() {
  const t = await getServerTranslator("dashboard");

  const actions = [
    { label: t("actionSearchExperience"), href: "/services", icon: Compass },
    { label: t("navBookings"), href: "/bookings", icon: CalendarCheck },
    { label: t("navPayments"), href: "/payments", icon: CreditCard },
    { label: t("navSettings"), href: "/dashboard/settings", icon: Settings2 },
  ];

  return (
    <Card hoverLift={false}>
      <h3 className="text-sm font-semibold text-foreground">{t("quickActionsTitle")}</h3>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background px-4 py-5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-premium focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <Icon size={20} strokeWidth={1.75} className="text-primary" />
              <span className="text-sm font-medium text-foreground">{action.label}</span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
