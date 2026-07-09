import { redirect } from "next/navigation";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { DashboardTopBar } from "@/components/dashboard/top-bar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { StatCard } from "@/components/dashboard/stat-card";
import { CategoryExplorer } from "@/components/dashboard/category-explorer";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { RecentBookingsTimeline } from "@/components/dashboard/recent-bookings";
import { PopularDestinations } from "@/components/dashboard/popular-destinations";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { FavoritesSection } from "@/components/dashboard/favorites-section";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { DashboardFooter } from "@/components/dashboard/dashboard-footer";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { CalendarCheck, MapPinned, Bell, Heart } from "lucide-react";
import { DESTINATION_IMAGES } from "@/components/dashboard/destination-image";

// Protected dashboard page — updated per this turn's explicit
// "reduce empty space, remove yellow placeholders, add real photo
// references, Framer Motion" feedback.
//
// PRESERVED EXACTLY: requireAuth() / UnauthenticatedError -> redirect
// handling, unchanged and verified against the pre-edit version.
//
// Experience data now includes category/duration (new fields the
// rebuilt ExperienceCard requires) and references DESTINATION_IMAGES
// paths — real <Image> tags, not fabricated gradients, per this turn's
// explicit instruction. See destination-image.tsx for why no actual
// photo files are included.

const featuredExperiences = [
  { title: "جولة في الجبل الأخضر", location: "الجبل الأخضر، عُمان", providerName: "عمان تريلز", price: "45 ر.ع", rating: 4.8, duration: "6 ساعات", category: "مغامرات", imageSrc: DESTINATION_IMAGES.jebelAkhdar },
  { title: "رحلة صحراء الشرقية", location: "الشرقية، عُمان", providerName: "دروب الصحراء", price: "60 ر.ع", rating: 4.6, duration: "يوم كامل", category: "صحراء", imageSrc: DESTINATION_IMAGES.sharqiyaSands },
  { title: "غوص في مسندم", location: "مسندم، عُمان", providerName: "أعماق الخليج", price: "80 ر.ع", rating: 4.9, duration: "4 ساعات", category: "غوص", imageSrc: DESTINATION_IMAGES.musandam },
];

const mostBooked = [
  { title: "جولة وادي دربات", location: "صلالة، عُمان", providerName: "مغامرات عُمان", price: "35 ر.ع", rating: 4.7, duration: "3 ساعات", category: "طبيعة", imageSrc: DESTINATION_IMAGES.wadiDarbat },
  { title: "رحلة موسم الخريف", location: "صلالة، عُمان", providerName: "دروب صلالة", price: "50 ر.ع", rating: 4.8, duration: "نصف يوم", category: "طبيعة", imageSrc: DESTINATION_IMAGES.salalah },
];

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

  return (
    <div className="min-h-screen bg-background">
      <DashboardTopBar />

      <div className="flex">
        <DashboardSidebar />

        <main className="flex-1 overflow-y-auto">
          <DashboardHero />

          <div className="mx-auto flex max-w-6xl flex-col gap-9 px-8 py-9">
            <CategoryExplorer />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="الحجوزات النشطة" value="—" icon={CalendarCheck} />
              <StatCard label="الرحلات القادمة" value="—" icon={MapPinned} />
              <StatCard label="الإشعارات" value="—" icon={Bell} />
              <StatCard label="التجارب المحفوظة" value="—" icon={Heart} />
            </div>

            <div>
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
                <span aria-hidden>⭐</span>
                التجارب المميزة
              </h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {featuredExperiences.map((experience) => (
                  <ExperienceCard key={experience.title} {...experience} />
                ))}
              </div>
            </div>

            <PopularDestinations />

            <div>
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
                <span aria-hidden>🔥</span>
                الأكثر حجزاً
              </h2>
              <div className="flex flex-col gap-4">
                {mostBooked.map((experience) => (
                  <ExperienceCard key={experience.title} layout="horizontal" {...experience} />
                ))}
              </div>
            </div>

            <FavoritesSection />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <RecentBookingsTimeline />
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
