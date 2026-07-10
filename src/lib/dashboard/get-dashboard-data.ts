import "server-only";
import { prisma } from "@/lib/db";

// Dashboard data fetching — Engineering Sprint (Dashboard Data Wiring).
//
// Deliberately separate from src/lib/auth/rbac.ts — this module only
// reads dashboard-relevant data given an already-authenticated
// barqUserId; it does not touch session resolution, role checks, or
// any RBAC logic, per explicit instruction not to modify RBAC.
//
// HANDLES THE NO-CUSTOMER-PROFILE CASE EXPLICITLY: a BARQ User can
// exist with no Customer/Provider/Staff/Admin sub-profile at all (per
// DOMAIN_MODEL.md) — a newly authenticated user who has never made a
// booking. Every query below returns an honest empty/zero result for
// that case rather than erroring, per explicit task requirement #7.

function extractArabicText(value: unknown): string {
  if (value && typeof value === "object" && "ar" in value) {
    const ar = (value as { ar?: unknown }).ar;
    if (typeof ar === "string") return ar;
  }
  return "";
}

export type DashboardBookingSummary = {
  id: string;
  serviceName: string;
  status: string;
  confirmedAt: Date | null;
};

export type DashboardFeaturedService = {
  id: string;
  name: string;
  providerName: string;
  price: string | null;
};

export type DashboardData = {
  hasCustomerProfile: boolean;
  activeBookingsCount: number;
  upcomingBookingsCount: number;
  notificationsCount: number;
  upcomingBookings: DashboardBookingSummary[];
  featuredServices: DashboardFeaturedService[];
  mostBookedServices: DashboardFeaturedService[];
};

// Minimal local type for Service query results with provider/prices
// joined — @prisma/client's generated types are unresolvable in this
// sandbox (no network access to install it), so this is hand-typed
// rather than inferred, matching only the fields actually consumed
// below. Hoisted here once rather than duplicated in both functions
// that need it.
type ServiceWithJoins = {
  id: string;
  name: unknown;
  provider: { businessName: unknown };
  prices: Array<{ amount: unknown; currency: string }>;
};

export async function getDashboardData(barqUserId: string): Promise<DashboardData> {
  const customer = await prisma.customer.findUnique({
    where: { userId: barqUserId },
  });

  const notificationsCount = await prisma.notification.count({
    where: { userId: barqUserId },
  });

  if (!customer) {
    // Honest empty state — no fabricated numbers for a user with no
    // Customer profile yet, per explicit requirement #7.
    const [featuredServices, mostBookedServices] = await Promise.all([
      getFeaturedServices(),
      getMostBookedServices(),
    ]);
    return {
      hasCustomerProfile: false,
      activeBookingsCount: 0,
      upcomingBookingsCount: 0,
      notificationsCount,
      upcomingBookings: [],
      featuredServices,
      mostBookedServices,
    };
  }

  const [activeBookingsCount, upcomingBookingsRaw, featuredServices, mostBookedServices] = await Promise.all([
    prisma.booking.count({
      where: {
        customerId: customer.id,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
      },
    }),
    prisma.booking.findMany({
      where: {
        customerId: customer.id,
        status: "CONFIRMED",
      },
      orderBy: { confirmedAt: "asc" },
      take: 5,
      include: { service: true },
    }),
    getFeaturedServices(),
    getMostBookedServices(),
  ]);

  const upcomingBookings: DashboardBookingSummary[] = upcomingBookingsRaw.map(
    (booking: { id: string; status: string; confirmedAt: Date | null; service: { name: unknown } }) => ({
      id: booking.id,
      serviceName: extractArabicText(booking.service.name) || "تجربة",
      status: booking.status,
      confirmedAt: booking.confirmedAt,
    })
  );

  return {
    hasCustomerProfile: true,
    activeBookingsCount,
    upcomingBookingsCount: upcomingBookings.length,
    notificationsCount,
    upcomingBookings,
    featuredServices,
    mostBookedServices,
  };
}

async function getMostBookedServices(): Promise<DashboardFeaturedService[]> {
  // Real aggregation over existing Booking/Service data — a GROUP BY +
  // COUNT, not an invented recommendation feature. Excludes CANCELLED
  // so a service isn't "most booked" on the back of cancellations.
  const grouped = await prisma.booking.groupBy({
    by: ["serviceId"],
    where: { status: { not: "CANCELLED" } },
    _count: { serviceId: true },
    orderBy: { _count: { serviceId: "desc" } },
    take: 5,
  });

  if (grouped.length === 0) return [];

  const services = await prisma.service.findMany({
    where: { id: { in: grouped.map((g: { serviceId: string }) => g.serviceId) } },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
    },
  });

  const serviceById = new Map(services.map((s: ServiceWithJoins) => [s.id, s]));

  return grouped
    .map((g: { serviceId: string }) => serviceById.get(g.serviceId))
    .filter((service: ServiceWithJoins | undefined): service is ServiceWithJoins => Boolean(service))
    .map((service: ServiceWithJoins) => ({
      id: service.id,
      name: extractArabicText(service.name) || "تجربة",
      providerName: extractArabicText(service.provider.businessName) || "مزود خدمة",
      price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    }));
}

async function getFeaturedServices(): Promise<DashboardFeaturedService[]> {
  const services = await prisma.service.findMany({
    where: { status: "PUBLISHED" },
    take: 6,
    orderBy: { createdAt: "desc" },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
    },
  });

  return services.map((service: ServiceWithJoins) => ({
    id: service.id,
    name: extractArabicText(service.name) || "تجربة",
    providerName: extractArabicText(service.provider.businessName) || "مزود خدمة",
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
  }));
}
