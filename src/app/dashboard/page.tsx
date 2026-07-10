import { redirect } from "next/navigation";
import { PackageOpen, Flame } from "lucide-react";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard/get-dashboard-data";
import { DashboardTopBar } from "@/components/dashboard/top-bar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
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
import { CalendarCheck, MapPinned, Bell, Heart } from "lucide-react";

// Protected dashboard page — Engineering Sprint (Dashboard Data
// Wiring). PRESERVED EXACTLY: requireAuth() / UnauthenticatedError ->
// redirect handling, verified unchanged.
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

  return (
    <div className="min-h-screen bg-background">
      <DashboardTopBar />

      <div className="flex">
        <DashboardSidebar />

        <main className="flex-1 overflow-y-auto">
          <DashboardHero />

          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
            <CategoryExplorer />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="الحجوزات النشطة" value={String(data.activeBookingsCount)} icon={CalendarCheck} />
              <StatCard label="الرحلات القادمة" value={String(data.upcomingBookingsCount)} icon={MapPinned} />
              <StatCard label="الإشعارات" value={String(data.notificationsCount)} icon={Bell} />
              {/* No Favorites/SavedExperience model exists — honest "—", not a fabricated count. */}
              <StatCard label="التجارب المحفوظة" value="—" icon={Heart} />
            </div>

            <div>
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
                <span aria-hidden>⭐</span>
                التجارب المميزة
              </h2>
              {data.featuredServices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
                  <PackageOpen size={28} strokeWidth={1.5} className="text-foreground/25" />
                  <p className="text-sm text-foreground/50">لا توجد تجارب منشورة حالياً</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {data.featuredServices.map((service) => (
                    <ExperienceCard
                      key={service.id}
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
                الأكثر حجزاً
              </h2>
              {data.mostBookedServices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
                  <Flame size={28} strokeWidth={1.5} className="text-foreground/25" />
                  <p className="text-sm text-foreground/50">لا توجد بيانات حجوزات كافية بعد</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {data.mostBookedServices.map((service) => (
                    <ExperienceCard
                      key={service.id}
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

            <p className="text-center text-xs text-foreground/20">معرف الحساب: {barqUserId}</p>
          </div>

          <DashboardFooter />
        </main>
      </div>
    </div>
  );
}
