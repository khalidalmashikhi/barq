import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Admin Customer list query — Admin Operations Platform.
//
// Mirrors get-providers.ts's/get-services.ts's filters-in/paginated-
// result-out shape. Phone number is the only legitimate display
// identity — Customer/User carry no name, avatar, or email field
// anywhere in the schema (phone-only auth), same documented policy
// already applied by get-bookings.ts (raw customerId) and
// get-provider-reviews-summary.ts (no customer identity at all). This
// query goes one step further and surfaces the phone number itself,
// since an admin-management list — unlike a provider-facing or
// customer-facing screen — has a legitimate operational need to
// identify a real person, not just an opaque id.
//
// bookingCount/reviewCount use Prisma's relation `_count`, resolved in
// the same query as the page of customers — never a separate query per
// row, never an N+1.

export type CustomerListItem = {
  id: string;
  phoneNumber: string;
  createdAt: Date;
  bookingCount: number;
  reviewCount: number;
};

export type CustomerListFilters = {
  q?: string;
  page?: number;
  pageSize?: number;
};

export type CustomerListResult = {
  items: CustomerListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getCustomers(filters: CustomerListFilters = {}): Promise<CustomerListResult> {
  await requireAdmin();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const where = filters.q ? { user: { phoneNumber: { contains: filters.q } } } : {};

  const [totalCount, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { phoneNumber: true } },
        _count: { select: { bookings: true, reviews: true } },
      },
    }),
  ]);

  type CustomerRow = {
    id: string;
    createdAt: Date;
    user: { phoneNumber: string };
    _count: { bookings: number; reviews: number };
  };

  const items: CustomerListItem[] = (customers as CustomerRow[]).map((customer) => ({
    id: customer.id,
    phoneNumber: customer.user.phoneNumber,
    createdAt: customer.createdAt,
    bookingCount: customer._count.bookings,
    reviewCount: customer._count.reviews,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
