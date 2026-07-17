import { Package, CalendarCheck, Clock, Briefcase, FileEdit, Activity } from "lucide-react";
import { getProviderOverview } from "@/lib/provider/queries/get-provider-overview";
import { StatCard } from "@/components/dashboard/stat-card";
import { ProviderRecentActivity } from "@/components/provider/recent-activity";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Provider Dashboard — Phase 1a (Overview only).
//
// SIMPLIFIED (Phase 1b, layout.tsx introduced): this page no longer
// performs its own auth-gate or AppShell wrapping — src/app/provider/
// layout.tsx now owns both for the entire /provider/* route tree.
// getProviderOverview() still independently resolves and re-verifies
// provider.id via its own requireProvider() call (Security Hardening
// pass) — this page never supplies or trusts a provider identity on
// its behalf, regardless of what the layout already checked.

export default async function ProviderOverviewPage() {
  const data = await getProviderOverview();
  const t = await getServerTranslator("provider");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
      <h1 className="text-2xl font-semibold text-foreground">{t("overviewTitle")}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("publishedServicesLabel")} value={String(data.publishedServicesCount)} icon={Package} />
        <StatCard label={t("draftServicesLabel")} value={String(data.draftServicesCount)} icon={FileEdit} />
        <StatCard label={t("activeBookingsLabel")} value={String(data.activeBookingsCount)} icon={Briefcase} />
        <StatCard label={t("todayBookingsLabel")} value={String(data.todaysBookingsCount)} icon={CalendarCheck} />
        <StatCard label={t("upcomingBookingsLabel")} value={String(data.upcomingBookingsCount)} icon={Activity} />
        <StatCard label={t("openSlotsLabel")} value={String(data.upcomingOpenSlotsCount)} icon={Clock} />
      </div>

      <ProviderRecentActivity items={data.recentActivity} />
    </div>
  );
}
