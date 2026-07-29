import { Plus, Package, CalendarCheck, Clock, Bell, Wallet } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Quick Actions — Phase F.3 (Provider Dashboard). Real navigation
// shortcuts only. Phase 4.2 added the "Create Experience" shortcut now
// that create-service.ts is a real action — this component's own
// original note explained why it was withheld until then; that
// reasoning no longer applies now that the action exists.

export async function QuickActions() {
  const t = await getServerTranslator("provider");

  const actions = [
    { href: "/provider/services/new", label: t("createExperienceButton"), icon: Plus },
    { href: "/provider/services", label: t("navServices"), icon: Package },
    { href: "/provider/bookings", label: t("navBookings"), icon: CalendarCheck },
    { href: "/provider/earnings", label: t("navEarnings"), icon: Wallet },
    { href: "/provider/availability", label: t("navAvailability"), icon: Clock },
    { href: "/provider/notifications", label: t("navNotifications"), icon: Bell },
  ] as const;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-medium text-foreground/80">{t("quickActionsTitle")}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-3 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:bg-accent/10 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <Icon size={16} strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
