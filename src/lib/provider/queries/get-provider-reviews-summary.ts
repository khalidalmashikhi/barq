import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Provider Reviews Summary — Provider Analytics & Business Insights.
//
// FIRST PROVIDER-FACING REVIEW QUERY: confirmed by inspection before
// writing this file — src/lib/provider/ had no query surfacing review
// or rating data to a provider at all. Reuses the exact aggregate
// shape src/lib/services/get-provider-profile.ts already uses for the
// public storefront (Rating.value avg/count through
// Review.providerId, the field whose own schema comment states it
// exists specifically "for Provider aggregate-rating queries") —
// not a new aggregation strategy, the same one applied from a
// provider-authenticated angle instead of a public one.
//
// RATING null, NEVER 0, WHEN THERE IS NO DATA — mirrors
// get-provider-metrics.ts's own completion/cancellation rate
// convention: a provider with zero reviews has an undefined average
// rating, not a misleading 0.
//
// NO CUSTOMER IDENTITY: same established policy as
// getReviewsForService() (no name field exists on User/Customer at
// all) — recentReviews carries the reviewed service's name instead of
// any customer label, which is more operationally useful to a
// provider anyway ("which of my services was this about") than a
// generic "Customer" placeholder repeated on every row.

export type ProviderReviewItem = {
  id: string;
  serviceName: string;
  rating: number;
  content: string;
  createdAt: Date;
};

export type ProviderReviewsSummary = {
  averageRating: number | null;
  reviewCount: number;
  recentReviews: ProviderReviewItem[];
};

const RECENT_REVIEWS_LIMIT = 5;

// High-Rated Service Milestone — Provider Notifications & Operational
// Alerts phase. THE INITIAL PRODUCT RULE (approved): no rating-
// milestone rule existed anywhere in docs or code prior to this phase
// (confirmed by inspection); the threshold was resolved via an
// explicit AskUserQuestion during this phase's planning step ("What
// should trigger the High-Rated Milestone alert?", offering "4.5+
// average / 10+ reviews", "4.0+ average / 5+ reviews", and "skip this
// card"), and formally approved as: average rating >= 4.5 AND review
// count >= 10, BOTH conditions required. Kept as two named constants
// (never inlined, no configuration/settings/database introduced) so a
// future phase can revisit the numbers without touching the check
// itself — same convention already used for
// LOW_ACTIVITY_THRESHOLD_DAYS in get-provider-service-insights.ts.
export const HIGH_RATED_MILESTONE_MIN_RATING = 4.5;
export const HIGH_RATED_MILESTONE_MIN_REVIEWS = 10;

export function isHighRatedMilestone(summary: Pick<ProviderReviewsSummary, "averageRating" | "reviewCount">): boolean {
  return (
    summary.averageRating !== null &&
    summary.averageRating >= HIGH_RATED_MILESTONE_MIN_RATING &&
    summary.reviewCount >= HIGH_RATED_MILESTONE_MIN_REVIEWS
  );
}

export async function getProviderReviewsSummary(): Promise<ProviderReviewsSummary> {
  const { provider } = await requireProvider();
  const providerId = provider.id;
  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";

  const [ratingAggregate, recentReviewRows] = await Promise.all([
    prisma.rating.aggregate({
      where: { review: { providerId, moderationState: "PUBLISHED" } },
      _avg: { value: true },
      _count: { value: true },
    }),
    prisma.review.findMany({
      where: { providerId, moderationState: "PUBLISHED" },
      include: { rating: true, booking: { include: { service: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_REVIEWS_LIMIT,
    }),
  ]);

  type ReviewRow = {
    id: string;
    content: string;
    createdAt: Date;
    rating: { value: number } | null;
    booking: { service: { name: unknown } };
  };

  const recentReviews: ProviderReviewItem[] = (recentReviewRows as ReviewRow[]).map((review) => ({
    id: review.id,
    serviceName: extractLocalizedText(review.booking.service.name, locale) || fallbackServiceName,
    rating: review.rating?.value ?? 0,
    content: review.content,
    createdAt: review.createdAt,
  }));

  return {
    averageRating: ratingAggregate._avg.value,
    reviewCount: ratingAggregate._count.value,
    recentReviews,
  };
}
