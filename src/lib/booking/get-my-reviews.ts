import "server-only";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// My Reviews query — Customer Experience Platform.
//
// TWO STATES, ONE CUSTOMER RESOLUTION: "Awaiting Review" (COMPLETED
// bookings with no Review yet) and "Reviews Given" (this customer's own
// Review rows) are fetched together by one function so the
// authenticated Customer is resolved exactly once per page load, not
// once per section — mirrors get-my-bookings.ts's own requireAuth()
// (not requireCustomer()) pattern: a user with no Customer profile
// cannot have any bookings or reviews by definition, so the correct
// result is an honest empty page, not a thrown error.
//
// NO NEW MUTATION, NO NEW ELIGIBILITY RULE: this file only reads.
// Awaiting-review eligibility is exactly "status === COMPLETED AND no
// Review" — the same predicate create-review.ts's own canReviewBooking()
// check already enforces at write time; this is a read-only projection
// of the same rule, not a second, independently-invented one. Actually
// submitting a review still only ever happens on the existing booking
// detail page's own form (create-review.ts) — this module has no
// create/update/delete of its own.
//
// OWN CONTENT, NO MODERATION FILTER: get-provider-reviews-summary.ts
// filters to moderationState "PUBLISHED" because that is what OTHER
// people see on a provider's public page. This module never filters by
// moderationState — a customer sees every review they themselves wrote,
// regardless of its moderation state, since it is their own content.
//
// MINIMAL FIELDS ONLY: awaiting-review rows select just {id, service
// name} — no provider/price/availability join, since the only thing
// this section presents is "which booking, go leave a review" (a link
// to the existing booking detail page, which already re-fetches the
// full detail there).

export type AwaitingReviewBookingItem = {
  id: string;
  serviceName: string;
};

export type MyReviewItem = {
  id: string;
  bookingId: string;
  serviceId: string;
  serviceName: string;
  providerName: string;
  rating: number;
  content: string;
  createdAt: Date;
};

export type GetMyReviewsPageParams = {
  page?: number;
  pageSize?: number;
};

export type MyReviewsPageData = {
  awaitingReview: AwaitingReviewBookingItem[];
  reviewsGiven: MyReviewItem[];
  reviewsGivenTotalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;
// Honest cap, same tradeoff already accepted elsewhere in this
// codebase (e.g. get-provider-service-insights.ts's own catalog cap) —
// a customer with more than 20 unreviewed completed bookings sees only
// the 20 most recently confirmed; not a silent limit, documented here.
const AWAITING_REVIEW_LIMIT = 20;

export async function getMyReviewsPageData(params: GetMyReviewsPageParams = {}): Promise<MyReviewsPageData> {
  const { barqUser } = await requireAuth();
  const locale = await getLocale();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUser.id },
  });

  if (!customer) {
    // Honest empty state — a user with no Customer profile has zero
    // bookings and zero reviews by definition.
    return { awaitingReview: [], reviewsGiven: [], reviewsGivenTotalCount: 0, page, pageSize, totalPages: 1 };
  }

  const [awaitingReviewRows, reviewsGivenTotalCount, reviewsGivenRows] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: customer.id, status: "COMPLETED", review: null },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
      take: AWAITING_REVIEW_LIMIT,
      select: { id: true, service: { select: { name: true } } },
    }),
    prisma.review.count({ where: { customerId: customer.id } }),
    prisma.review.findMany({
      where: { customerId: customer.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        rating: true,
        booking: { select: { id: true, serviceId: true, service: { select: { name: true } }, provider: { select: { businessName: true } } } },
      },
    }),
  ]);

  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";
  const fallbackProviderName = locale === "ar" ? "مزود خدمة" : "Service Provider";

  type AwaitingReviewRow = { id: string; service: { name: unknown } };

  const awaitingReview: AwaitingReviewBookingItem[] = (awaitingReviewRows as AwaitingReviewRow[]).map((row) => ({
    id: row.id,
    serviceName: extractLocalizedText(row.service.name, locale) || fallbackServiceName,
  }));

  type ReviewRow = {
    id: string;
    content: string;
    createdAt: Date;
    rating: { value: number } | null;
    booking: { id: string; serviceId: string; service: { name: unknown }; provider: { businessName: unknown } };
  };

  const reviewsGiven: MyReviewItem[] = (reviewsGivenRows as ReviewRow[]).map((review) => ({
    id: review.id,
    bookingId: review.booking.id,
    serviceId: review.booking.serviceId,
    serviceName: extractLocalizedText(review.booking.service.name, locale) || fallbackServiceName,
    providerName: extractLocalizedText(review.booking.provider.businessName, locale) || fallbackProviderName,
    rating: review.rating?.value ?? 0,
    content: review.content,
    createdAt: review.createdAt,
  }));

  return {
    awaitingReview,
    reviewsGiven,
    reviewsGivenTotalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(reviewsGivenTotalCount / pageSize)),
  };
}
