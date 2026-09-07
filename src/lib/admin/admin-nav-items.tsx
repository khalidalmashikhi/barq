import { LayoutDashboard, Users, FolderTree, ToggleLeft, LayoutTemplate, Compass, Tag, CalendarClock, ClipboardList, UserRound, Star, CreditCard, ShieldCheck, Car, MailWarning, UserCog } from "lucide-react";
import { getPathname } from "@/i18n/navigation";
import type { AppNavItem } from "@/components/app-shell/app-shell";
import type { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { Locale } from "@/i18n/locales";
import type { PermissionKey } from "@/lib/auth/permissions";

type AdminTranslator = Awaited<ReturnType<typeof getServerTranslator<"admin">>>;

// STAFF RBAC (Gate Z-3) — the internal shell nav is PERMISSION-DRIVEN. Each item declares
// how it becomes visible:
//   • a PermissionKey → shown to a STAFF member who holds it (and to OWNER/ADMIN, who hold
//     all domain permissions). Set ONLY for domains whose pages/actions are already
//     permission-refactored (grows per gate turn) so a staff member never clicks into a
//     surface that would fail-closed on them.
//   • "ownerOrAdmin" → OWNER/ADMIN only (domains not yet refactored, plus admin-only areas).
//   • "owner" → OWNER only.
// Navigation is UX only — every page/action/API still enforces its own permission.
type NavVisibility = PermissionKey | "ownerOrAdmin" | "owner";

type AdminNavContext = {
  permissions: ReadonlySet<PermissionKey>;
  isAdmin: boolean;
  isOwner: boolean;
};

type InternalNavItem = AppNavItem & { show: NavVisibility };

export function getAdminNavItems(t: AdminTranslator, locale: Locale, ctx: AdminNavContext): AppNavItem[] {
  const items: InternalNavItem[] = [
    { show: "ownerOrAdmin", label: t("navOverview"), href: getPathname({ href: "/admin", locale }), icon: <LayoutDashboard size={18} strokeWidth={1.75} /> },
    { show: "providers.read", label: t("navProviders"), href: getPathname({ href: "/admin/providers", locale }), icon: <Users size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navVehicles"), href: getPathname({ href: "/admin/vehicles", locale }), icon: <Car size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navServices"), href: getPathname({ href: "/admin/services", locale }), icon: <Compass size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navPrices"), href: getPathname({ href: "/admin/prices", locale }), icon: <Tag size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navAvailability"), href: getPathname({ href: "/admin/availability", locale }), icon: <CalendarClock size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navBookings"), href: getPathname({ href: "/admin/bookings", locale }), icon: <ClipboardList size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navCustomers"), href: getPathname({ href: "/admin/customers", locale }), icon: <UserRound size={18} strokeWidth={1.75} /> },
    { show: "reviews.read", label: t("navReviews"), href: getPathname({ href: "/admin/reviews", locale }), icon: <Star size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navPayments"), href: getPathname({ href: "/admin/payments", locale }), icon: <CreditCard size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navEmailDeliveries"), href: getPathname({ href: "/admin/email-deliveries", locale }), icon: <MailWarning size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navUserManagement"), href: getPathname({ href: "/admin/users", locale }), icon: <ShieldCheck size={18} strokeWidth={1.75} /> },
    { show: "owner", label: t("navStaff"), href: getPathname({ href: "/admin/staff", locale }), icon: <UserCog size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navCategories"), href: getPathname({ href: "/admin/categories", locale }), icon: <FolderTree size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navFeatureFlags"), href: getPathname({ href: "/admin/feature-flags", locale }), icon: <ToggleLeft size={18} strokeWidth={1.75} /> },
    { show: "ownerOrAdmin", label: t("navHomepageSections"), href: getPathname({ href: "/admin/homepage-sections", locale }), icon: <LayoutTemplate size={18} strokeWidth={1.75} /> },
  ];

  return items
    .filter((item) => {
      if (item.show === "owner") return ctx.isOwner; // OWNER only, even for a non-owner ADMIN
      if (ctx.isAdmin) return true; // OWNER/ADMIN see every non-owner-only module
      if (item.show === "ownerOrAdmin") return false; // a STAFF member never sees these
      return ctx.permissions.has(item.show); // a STAFF member sees converted modules they hold
    })
    .map(({ show, ...navItem }) => {
      void show; // strip the visibility discriminator from the returned nav item
      return navItem;
    });
}

// The first STAFF-reachable internal module path for a permission set (in nav order), or
// null if none. Lands a Staff member on a working module instead of the admin-only Overview.
// Lists ONLY domains whose pages are permission-refactored (grows per gate turn).
const STAFF_LANDING_ORDER: ReadonlyArray<readonly [PermissionKey, string]> = [
  ["providers.read", "/admin/providers"],
  ["reviews.read", "/admin/reviews"],
];

export function firstAllowedAdminPath(permissions: ReadonlySet<PermissionKey>): string | null {
  for (const [perm, path] of STAFF_LANDING_ORDER) if (permissions.has(perm)) return path;
  return null;
}
