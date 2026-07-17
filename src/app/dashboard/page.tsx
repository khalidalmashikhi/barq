import { redirect } from "next/navigation";
import { PackageOpen, Flame, Compass, CalendarCheck, Bell, Heart, Settings, MapPinned, Search } from "lucide-react";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard/get-dashboard-data";
import { AppShell, type AppNavItem } from "@/components/app-shell/app-shell";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { StatCard } from "@/components/dashboard/stat-card";
import { CategoryExplorer } from "@/components/dashboard/category-explorer";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { RecentBookingsTimeline } from "@/components/dashboard/recent-bookings";
import { PopularDestinations } from "@/components/dashboard/popular-destinations";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { FavoritesSection } from "@/components/dashboard/favorites-section";
import { RecommendedSection } from "@/components/dashboard/recommended-section";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { DashboardFooter } from "@/components/dashboard/dashboard-footer";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";

// Protected dashboard page — Engineering Sprint (Dashboard Data
// Wiring), retrofitted onto the shared AppShell (AppShell Migration —
// Stabilization). PRESERVED EXACTLY: requireAuth() /
// UnauthenticatedError -> redirect handling, verified unchanged; same
// nav items/labels/icons/badges as before; same top-bar search box;
// same page content below.
//
// Nav items now carry a real `href` for the two destinations that
// actually exist (/dashboard, /bookings) — AppSidebar derives "active"
// from the real current pathname rather than a hardcoded flag, fixing
// a real pre-existing defect (see AppSidebar's own doc comment). The
// three items with no built destination yet (Notifications/Favorites/
// Settings) remain visible but non-interactive, exactly as before —
// no route was invented for them.
//
// REAL DATA: active/upcoming booking counts, notification count,
// upcoming bookings timeline, Featured Experiences, Most Booked — all
// via getDashboardData(), all real queries against existing models.
//
// HONEST EMPTY STATES, NOT FABRICATED DATA: Favorites (no model),
// Recommended (no recommendation engine), Recent Activity (no
// customer-facing activity model) — each component now renders its
// own empty state internally; see their individual files.
//
// STATIC INFORMATIONAL CONTENT, NOT "DATA" IN THE SENSE THIS SPRINT
// TARGETS: PopularDestinations (named real Omani places, not business
// records), CategoryExplorer (fixed category labels), QuickActions
// (UI shortcuts, not data) — left as-is; converting these isn't part
// of "replacing placeholder/mock data with real database-backed data."
//
// INTERNATIONALIZATION PHASE A.2: nav item labels, the role label, and
// the top-bar search placeholder now come from next-intl's
// "dashboard" namespace (via getServerTranslator — this is a Server
// Component), fixing a real pre-existing defect: this file previously
// hardcoded these 7 strings directly, bypassing even strings.ts's
// stopgap entirely (unlike provider/layout.tsx, which already used
// t.provider* keys). Every OTHER string in this file below (headings,
// StatCard labels, empty states, the account-id line) is page content,
// out of this phase's explicit scope, and is untouched.

export default async function DashboardPage() {
  let barqUserId: string;

  try {
    const { barqUser } = await requireAuth();
    barqUserId = barqUser.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    throw error;
  }

  const data = await getDashboardData(barqUserId);
  const t = await getServerTranslator("dashboard");
  const tServices = await getServerTranslator("services");

  const customerNavItems: AppNavItem[] = [
    { label: t("navOverview"), href: "/dashboard", icon: <Compass size={18} strokeWidth={1.75} /> },
    { label: t("navBookings"), href: "/bookings", icon: <CalendarCheck size={18} strokeWidth={1.75} /> },
    { label: t("navNotifications"), icon: <Bell size={18} strokeWidth={1.75} />, badge: 3 },
    { label: t("navSaved"), icon: <Heart size={18} strokeWidth={1.75} /> },
    { label: t("navSettings"), icon: <Settings size={18} strokeWidth={1.75} /> },
  ];

  const customerTopBarSearch = (
    <div className="hidden max-w-md flex-1 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 mx-8 md:flex">
      <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
      <input
        type="search"
        placeholder={t("searchPlaceholder")}
        className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        disabled
      />
    </div>
  );

  return (
    <AppShell navItems={customerNavItems} roleLabel={t("roleLabel")} topBarCenterContent={customerTopBarSearch}>
      <DashboardHero />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
        <CategoryExplorer />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("statActiveBookingsLabel")} value={String(data.activeBookingsCount)} icon={CalendarCheck} />
          <StatCard label={t("statUpcomingTripsLabel")} value={String(data.upcomingBookingsCount)} icon={MapPinned} />
          <StatCard label={t("navNotifications")} value={String(data.notificationsCount)} icon={Bell} />
          {/* No Favorites/SavedExperience model exists — honest "—", not a fabricated count. */}
          <StatCard label={t("statSavedExperiencesLabel")} value="—" icon={Heart} />
        </div>

        <div>
          <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
            <span aria-hidden>⭐</span>
            {t("featuredExperiencesTitle")}
          </h2>
          {data.featuredServices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
              <PackageOpen size={28} strokeWidth={1.5} className="text-foreground/25" />
              <p className="text-sm text-foreground/50">{tServices("noPublishedServicesLabel")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.featuredServices.map((service) => (
                <ExperienceCard
                  key={service.id}
                  serviceId={service.id}
                  title={service.name}
                  providerName={service.providerName}
                  price={service.price}
                />
              ))}
            </div>
          )}
        </div>

        <PopularDestinations />

        <div>
          <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
            <span aria-hidden>🔥</span>
            {t("mostBookedTitle")}
          </h2>
          {data.mostBookedServices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
              <Flame size={28} strokeWidth={1.5} className="text-foreground/25" />
              <p className="text-sm text-foreground/50">{t("noBookingDataLabel")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {data.mostBookedServices.map((service) => (
                <ExperienceCard
                  key={service.id}
                  serviceId={service.id}
                  layout="horizontal"
                  title={service.name}
                  providerName={service.providerName}
                  price={service.price}
                />
              ))}
            </div>
          )}
        </div>

        <FavoritesSection />

        <RecommendedSection />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentBookingsTimeline bookings={data.upcomingBookings} />
          </div>
          <QuickActions />
        </div>

        <ActivityFeed />

        <p className="text-center text-xs text-foreground/20">{t("accountIdLabel", { id: barqUserId })}</p>
      </div>

      <DashboardFooter />
    </AppShell>
  );
}
