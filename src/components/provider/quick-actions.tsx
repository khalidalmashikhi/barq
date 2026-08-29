import { Plus, CalendarCheck, Clock, Eye } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Quick Actions — Provider Home. Real navigation shortcuts only, trimmed to the
// highest-value daily tasks and biased toward destinations that are NOT already a
// one-tap sidebar item (create a service, preview the public profile) so the panel
// earns its place instead of mirroring the nav.

export async function QuickActions() {
  const t = await getServerTranslator("provider");

  const actions = [
    { href: "/provider/services/new", label: t("createExperienceButton"), icon: Plus },
    { href: "/provider/bookings", label: t("navBookings"), icon: CalendarCheck },
    { href: "/provider/availability", label: t("navAvailability"), icon: Clock },
    { href: "/provider/preview", label: t("previewProfileButton"), icon: Eye },
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
