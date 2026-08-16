import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isValidUuid } from "@/lib/uuid";
import type { ProviderStatus } from "@prisma/client";

// Admin Provider list query — Phase 2 (Provider Foundation). Mirrors
// get-categories.ts's filters-in/paginated-result-out shape, using the
// same bilingual JSON-path search strategy for `businessName`. Distinct
// from get-pending-providers.ts (which stays as-is, hardcoded to
// APPLIED/UNDER_REVIEW for the existing approval-queue view) — this is
// the general admin-management list across every status.
//
// AUTH: requireAdmin() — admin-management view, not the public
// Marketplace browsing surface this phase explicitly excludes.

export type ProviderListItem = {
  id: string;
  userId: string;
  phoneNumber: string;
  businessName: string;
  slug: string | null;
  status: string;
  // Review-first list UX (Gate A) — the INDIVIDUAL/COMPANY kind and the explicit
  // submission timestamp (null until the provider submits, per Gate 1A) let the
  // list summarize each application at a glance without opening the detail page.
  providerType: string;
  submittedAt: Date | null;
  visible: boolean;
  city: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderListFilters = {
  q?: string;
  status?: ProviderStatus;
  page?: number;
  pageSize?: number;
};

export type ProviderListResult = {
  items: ProviderListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getProviders(filters: ProviderListFilters = {}): Promise<ProviderListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Search by bilingual businessName (JSON path, same strategy as
  // get-categories.ts/get-services.ts), plus — for the User & Access
  // Management view — the owning User's phone number (contains) and, when the
  // query is a valid UUID, the exact User ID. Never name/email (none exist).
  const searchClause = filters.q
    ? {
        OR: [
          { businessName: { path: ["ar"], string_contains: filters.q } },
          { businessName: { path: ["en"], string_contains: filters.q } },
          { user: { phoneNumber: { contains: filters.q } } },
          ...(isValidUuid(filters.q) ? [{ userId: filters.q }] : []),
        ],
      }
    : {};

  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...searchClause,
  };

  const [totalCount, providers] = await Promise.all([
    prisma.provider.count({ where }),
    prisma.provider.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { phoneNumber: true } } },
    }),
  ]);

  const items: ProviderListItem[] = providers.map((provider) => ({
    id: provider.id,
    userId: provider.userId,
    // `user` is always loaded by the include above in production; the optional
    // chain only guards synthetic test stores that don't model the relation.
    phoneNumber: provider.user?.phoneNumber ?? "",
    businessName: extractLocalizedText(provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    slug: provider.slug,
    status: provider.status,
    providerType: provider.providerType,
    submittedAt: provider.submittedAt,
    visible: provider.visible,
    city: provider.city,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
