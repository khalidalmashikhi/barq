import type { Metadata } from "next";
import { PackageOpen, Flame, Search } from "lucide-react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireAuth, UnauthenticatedError, hasActiveAdminProfile, hasApprovedProviderProfile } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard/get-dashboard-data";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { AppShell } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
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
import { CustomerKpiRow } from "@/components/dashboard/customer-kpi-row";
import { RecentBookingsList } from "@/components/dashboard/recent-bookings-list";
import { AwaitingReviewNudge } from "@/components/dashboard/awaiting-review-nudge";

// Protected dashboard page — Engineering Sprint (Dashboard Data
// Wiring), retrofitted onto the shared AppShell (AppShell Migration —
// Stabilization). PRESERVED EXACTLY: requireAuth() /
// UnauthenticatedError -> redirect handling, verified unchanged; same
// nav items/labels/icons/badges as before; same top-bar search box;
// same page content below.
//
// PHASE B GROUP 1 — MOVED UNDER [locale]: this file previously lived
// at src/app/dashboard/page.tsx, unreachable from any locale-prefixed
// URL. `redirect` now comes from src/i18n/navigation.ts (auto-prepends
// the current request's locale) instead of next/navigation directly.
// Both the "Overview" and "Bookings" nav items' hrefs are computed via
// getPathname() for the same reason.
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
//
// UX REMEDIATION — Admin navigation entry: every authenticated user,
// Admin included, lands here after login (LoginForm always redirects to
// /dashboard, never branches by role — unchanged by this fix, since the
// existing UX gives no basis for a different role-based landing page).
// This was previously a dead end for an Admin: no link anywhere pointed
// at /admin/*, so they had to type the URL by hand. hasActiveAdminProfile()
// (a non-throwing companion to requireAdmin() — see rbac.ts's own
// comment) now runs a real, server-side database check; when it's true,
// one "Admin Panel" item is appended to this same customerNavItems
// array AppSidebar/AppMobileNav already render — no client-side-only
// hiding, no duplicate second nav surface, and requireAdmin() still
// independently re-checks on every actual /admin/* request regardless
// of whether this link is ever shown or clicked.

// Phase B Group 5 Closure — private, authenticated route: explicit
// noindex/nofollow as defense-in-depth alongside the auth gate below
// (not a replacement for it). No canonical/hreflang — this route is
// never meant to be indexed under any locale.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  let barqUserId: string;

  const locale = await getLocale();

  try {
    const { barqUser } = await requireAuth();
    barqUserId = barqUser.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
    }
    throw error;
  }

  // Phase 5.2 (Production Hardening) — these two were previously
  // awaited sequentially despite being fully independent queries;
  // batched into one Promise.all to shave a round-trip off this page's
  // TTFB. isAdmin joins the same batch for the same reason — one more
  // independent, cheap query, not a reason to add a second round-trip.
  const [data, unreadNotificationsCount, isAdmin, isApprovedProvider] = await Promise.all([
    getDashboardData(barqUserId),
    getUnreadCount(),
    hasActiveAdminProfile(barqUserId),
    hasApprovedProviderProfile(barqUserId),
  ]);
  const t = await getServerTranslator("dashboard");
  const tServices = await getServerTranslator("services");

  // Customer Experience Platform — CONSOLIDATED onto the shared
  // getCustomerNavItems() helper (previously this page maintained its
  // own separate inline array, duplicating the identical Overview/
  // Bookings/Notifications/Saved/Settings items every other Customer
  // page already built via that helper — a real, confirmed duplication
  // this phase's own inspection flagged). `isAdmin` is still resolved
  // here, exactly as before (hasActiveAdminProfile() in the Promise.all
  // above) — the helper itself performs no RBAC check; it only renders
  // based on the already-resolved `isAdmin`/`showBecomeProvider` flags
  // passed in via `options`, per this phase's explicit "no RBAC logic
  // in the presentation layer" requirement.
  const customerNavItems = getCustomerNavItems(t, locale, unreadNotificationsCount, {
    // An APPROVED provider lands on this customer dashboard after login and
    // otherwise has no discoverable link into /provider — give them the
    // workspace doorway instead of "Become Provider" (they already are one).
    showProviderWorkspace: isApprovedProvider,
    showBecomeProvider: !isApprovedProvider,
    isAdmin,
  });

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
    <AppShell
      navItems={customerNavItems}
      roleLabel={t("roleLabel")}
      topBarCenterContent={customerTopBarSearch}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <DashboardHero />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
        <CategoryExplorer />

        {data.awaitingReviewCount > 0 && <AwaitingReviewNudge count={data.awaitingReviewCount} />}

        <CustomerKpiRow
          totalBookings={data.bookingStatusCounts.total}
          activeBookings={data.bookingStatusCounts.active}
          completedBookings={data.bookingStatusCounts.completed}
          cancelledBookings={data.bookingStatusCounts.cancelled}
          reviewsGiven={data.reviewsGivenCount}
          awaitingReview={data.awaitingReviewCount}
          unreadNotifications={data.notificationsCount}
        />

        <div>
          <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
            <span aria-hidden>⭐</span>
            {t("featuredExperiencesTitle")}
          </h2>
          {data.featuredServices.length === 0 ? (
            <EmptyState icon={PackageOpen} message={tServices("noPublishedServicesLabel")} />
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
            <EmptyState icon={Flame} message={t("noBookingDataLabel")} />
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

        <RecentBookingsList bookings={data.recentBookings} />

        <ActivityFeed />

        <p className="text-center text-xs text-foreground/20">{t("accountIdLabel", { id: barqUserId })}</p>
      </div>

      <DashboardFooter />
    </AppShell>
  );
}
