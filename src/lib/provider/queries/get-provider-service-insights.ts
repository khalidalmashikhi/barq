import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getProviderServices } from "./get-provider-services";

// Provider Service Insights — Provider Analytics & Business Insights.
//
// REUSES, DOES NOT DUPLICATE: `hasNoUpcomingAvailability` was already
// computed by getProviderServices() in the previous "Provider
// Operations Foundation" phase — this module calls that function
// directly rather than re-deriving the same published-service/
// upcoming-OPEN-slot join a second time, per this phase's own
// "avoid duplicated aggregation" instruction. The one genuinely new
// query here is a single booking-count-by-service groupBy (needed for
// the low-activity check below), which piggybacks on the same
// Promise.all as the getProviderServices() call rather than running
// sequentially after it.
//
// CATALOG CAP: fetches up to 100 published services (pageSize: 100) —
// a real, documented limit, not a silent one: a provider with more
// than 100 published services would only have their 100 most recent
// considered here. No current provider in this system approaches that
// scale; this is the same honest-cap tradeoff already accepted
// elsewhere in this codebase (e.g. topServices' own take: 5) rather
// than building unbounded-catalog pagination for a dashboard summary.
//
// LOW-ACTIVITY THRESHOLD — DECISION SOURCE, CITED PRECISELY: "published
// >= 30 days ago AND zero bookings ever." Both halves are real,
// already-stored columns (Service.createdAt, a real absence from the
// Booking groupBy below) — no invented data. The 30-day cutoff itself
// is a judgment call, not derivable from data alone; it was resolved
// via an explicit AskUserQuestion posed during this phase's planning
// step ("For the 'Low Booking Activity' attention widget, what
// threshold should flag a published service as low-activity?"),
// offering "14 days", "30 days", and "skip this widget" as options —
// the requester selected "30 days, zero bookings" before this module
// was written. Treat 30 as this phase's INITIAL operational threshold,
// not a permanently fixed one: it is kept as this one named constant
// (never inlined as a bare magic number) specifically so a future
// phase can turn it into a real configurable setting without touching
// the filtering logic below — no settings infrastructure exists yet,
// and none is introduced here.

const PUBLISHED_CATALOG_CAP = 100;
const LOW_ACTIVITY_THRESHOLD_DAYS = 30;

export type ProviderServiceInsightItem = {
  id: string;
  name: string;
  createdAt: Date;
};

export type ProviderServiceInsights = {
  /// Published services with zero upcoming OPEN availability slots —
  /// see getProviderServices()'s own hasNoUpcomingAvailability note.
  needingAttention: ProviderServiceInsightItem[];
  /// Published services live for 30+ days with zero bookings ever
  /// (any status, not just completed) — a real, computed signal, never
  /// a stored flag.
  lowActivity: ProviderServiceInsightItem[];
};

export async function getProviderServiceInsights(): Promise<ProviderServiceInsights> {
  const { provider } = await requireProvider();

  const [publishedServices, bookingCountRows] = await Promise.all([
    getProviderServices({ status: "PUBLISHED", pageSize: PUBLISHED_CATALOG_CAP }),
    prisma.booking.groupBy({
      by: ["serviceId"],
      where: { providerId: provider.id },
      _count: true,
    }),
  ]);

  const servicesWithAnyBooking = new Set(bookingCountRows.map((row) => row.serviceId));
  const thirtyDaysAgo = new Date(Date.now() - LOW_ACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const needingAttention: ProviderServiceInsightItem[] = publishedServices.items
    .filter((service) => service.hasNoUpcomingAvailability)
    .map((service) => ({ id: service.id, name: service.name, createdAt: service.createdAt }));

  const lowActivity: ProviderServiceInsightItem[] = publishedServices.items
    .filter((service) => service.createdAt <= thirtyDaysAgo && !servicesWithAnyBooking.has(service.id))
    .map((service) => ({ id: service.id, name: service.name, createdAt: service.createdAt }));

  return { needingAttention, lowActivity };
}
