import { LayoutDashboard, Users, FolderTree, ToggleLeft, LayoutTemplate, Compass, Tag, CalendarClock, ClipboardList, UserRound, Star, CreditCard, ShieldCheck } from "lucide-react";
import { getPathname } from "@/i18n/navigation";
import type { AppNavItem } from "@/components/app-shell/app-shell";
import type { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { Locale } from "@/i18n/locales";

type AdminTranslator = Awaited<ReturnType<typeof getServerTranslator<"admin">>>;

// Shared Admin nav item builder — Admin Operations Platform.
//
// Extracted from admin/layout.tsx's own inline array (previously
// untestable inline JSX) so nav composition/order can be unit-tested
// directly, mirroring src/lib/dashboard/customer-nav-items.tsx's own
// extraction. "Overview" is added as the first item per this phase's
// explicit requirement; "Customers" and "Reviews" are the two new
// route groups this phase adds — placed alongside the other core
// marketplace-operations items (Providers/Services/Prices/
// Availability/Bookings), before the content-configuration items
// (Categories/Feature Flags/Homepage Sections) that were already
// last. Every pre-existing item is preserved, unchanged, in the same
// relative order.
export function getAdminNavItems(t: AdminTranslator, locale: Locale): AppNavItem[] {
  return [
    { label: t("navOverview"), href: getPathname({ href: "/admin", locale }), icon: <LayoutDashboard size={18} strokeWidth={1.75} /> },
    { label: t("navProviders"), href: getPathname({ href: "/admin/providers", locale }), icon: <Users size={18} strokeWidth={1.75} /> },
    { label: t("navServices"), href: getPathname({ href: "/admin/services", locale }), icon: <Compass size={18} strokeWidth={1.75} /> },
    { label: t("navPrices"), href: getPathname({ href: "/admin/prices", locale }), icon: <Tag size={18} strokeWidth={1.75} /> },
    { label: t("navAvailability"), href: getPathname({ href: "/admin/availability", locale }), icon: <CalendarClock size={18} strokeWidth={1.75} /> },
    { label: t("navBookings"), href: getPathname({ href: "/admin/bookings", locale }), icon: <ClipboardList size={18} strokeWidth={1.75} /> },
    { label: t("navCustomers"), href: getPathname({ href: "/admin/customers", locale }), icon: <UserRound size={18} strokeWidth={1.75} /> },
    { label: t("navReviews"), href: getPathname({ href: "/admin/reviews", locale }), icon: <Star size={18} strokeWidth={1.75} /> },
    { label: t("navPayments"), href: getPathname({ href: "/admin/payments", locale }), icon: <CreditCard size={18} strokeWidth={1.75} /> },
    { label: t("navUserManagement"), href: getPathname({ href: "/admin/users", locale }), icon: <ShieldCheck size={18} strokeWidth={1.75} /> },
    { label: t("navCategories"), href: getPathname({ href: "/admin/categories", locale }), icon: <FolderTree size={18} strokeWidth={1.75} /> },
    { label: t("navFeatureFlags"), href: getPathname({ href: "/admin/feature-flags", locale }), icon: <ToggleLeft size={18} strokeWidth={1.75} /> },
    { label: t("navHomepageSections"), href: getPathname({ href: "/admin/homepage-sections", locale }), icon: <LayoutTemplate size={18} strokeWidth={1.75} /> },
  ];
}
