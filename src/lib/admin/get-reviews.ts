import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { isValidUuid } from "@/lib/uuid";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { ReviewModerationState } from "@prisma/client";

// Admin Reviews list query — Admin Operations Platform.
//
// READ-ONLY, BY DESIGN: this module has no mutation of any kind — no
// flag/publish/remove action exists here or anywhere else this phase
// adds. The schema already models moderation via
// Review.moderationState (PUBLISHED | FLAGGED | REMOVED, see
// prisma/schema.prisma), but no application code writes anything other
// than the default PUBLISHED today — this query can filter by any of
// the three values (since the column itself is real), it does not
// introduce a workflow that changes them.
//
// UNSCOPED BY MODERATION STATE BY DEFAULT: unlike
// get-provider-reviews-summary.ts (which always filters
// moderationState: "PUBLISHED", since that is a provider-facing
// display of their own public reputation), this admin query shows
// every review regardless of state unless the caller explicitly filters
// — an admin inspection screen needs to see FLAGGED/REMOVED rows too,
// not just the public-facing subset.

export type ReviewAdminListItem = {
  id: string;
  bookingId: string;
  customerId: string;
  customerPhoneNumber: string | null;
  providerId: string;
  providerName: string;
  serviceName: string;
  rating: number;
  content: string;
  moderationState: ReviewModerationState;
  createdAt: Date;
};

export type ReviewAdminListFilters = {
  moderationState?: ReviewModerationState;
  providerId?: string;
  customerId?: string;
  bookingId?: string;
  rating?: number;
  page?: number;
  pageSize?: number;
};

export type ReviewAdminListResult = {
  items: ReviewAdminListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getReviews(filters: ReviewAdminListFilters = {}): Promise<ReviewAdminListResult> {
  await requireAdmin();
  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";
  const fallbackProviderName = locale === "ar" ? "مزود خدمة" : "Service Provider";

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Malformed providerId/customerId/bookingId -> empty result, same
  // defensive convention as every sibling admin list query.
  if (filters.providerId !== undefined && !isValidUuid(filters.providerId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }
  if (filters.customerId !== undefined && !isValidUuid(filters.customerId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }
  if (filters.bookingId !== undefined && !isValidUuid(filters.bookingId)) {
    return { items: [], totalCount: 0, page, pageSize, totalPages: 1 };
  }

  const where = {
    ...(filters.moderationState ? { moderationState: filters.moderationState } : {}),
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    ...(filters.rating !== undefined ? { rating: { value: filters.rating } } : {}),
  };

  const [totalCount, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        rating: true,
        customer: { select: { user: { select: { phoneNumber: true } } } },
        provider: { select: { businessName: true } },
        booking: { select: { service: { select: { name: true } } } },
      },
    }),
  ]);

  type ReviewRow = {
    id: string;
    bookingId: string;
    customerId: string;
    providerId: string;
    content: string;
    moderationState: ReviewModerationState;
    createdAt: Date;
    rating: { value: number } | null;
    customer: { user: { phoneNumber: string | null } };
    provider: { businessName: unknown };
    booking: { service: { name: unknown } };
  };

  const items: ReviewAdminListItem[] = (reviews as ReviewRow[]).map((review) => ({
    id: review.id,
    bookingId: review.bookingId,
    customerId: review.customerId,
    customerPhoneNumber: review.customer.user.phoneNumber,
    providerId: review.providerId,
    providerName: extractLocalizedText(review.provider.businessName, locale) || fallbackProviderName,
    serviceName: extractLocalizedText(review.booking.service.name, locale) || fallbackServiceName,
    rating: review.rating?.value ?? 0,
    content: review.content,
    moderationState: review.moderationState,
    createdAt: review.createdAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
