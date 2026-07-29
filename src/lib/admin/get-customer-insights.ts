import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Customer operational insights — Admin Operations Platform.
//
// "Customers Awaiting Reviews" reuses the EXACT same eligibility
// definition already established by the customer-facing
// src/lib/booking/get-my-reviews.ts (a COMPLETED booking with no
// attached Review) — expressed here as a `some` relation filter on
// Customer rather than re-deriving the rule, per this phase's explicit
// "do not create review eligibility logic again" instruction. "Customers
// With Most Bookings" uses a single groupBy(by:["customerId"]) — no
// per-customer count query, no N+1 — then joins the resulting ids back
// to Customer/User in one follow-up query.
//
// "Recently Registered Customers" needs no dedicated query here: it is
// exactly getCustomers()'s own default (createdAt desc) with no
// filter, so callers reuse that function directly rather than a
// second, redundant one.

export type CustomerRankingItem = {
  id: string;
  phoneNumber: string;
  bookingCount: number;
};

export type CustomerAwaitingReviewItem = {
  id: string;
  phoneNumber: string;
};

const PREVIEW_LIMIT = 5;

export async function getCustomersWithMostBookings(): Promise<{ items: CustomerRankingItem[] }> {
  await requireAdmin();

  const grouped = await prisma.booking.groupBy({
    by: ["customerId"],
    _count: true,
    orderBy: { _count: { customerId: "desc" } },
    take: PREVIEW_LIMIT,
  });

  if (grouped.length === 0) {
    return { items: [] };
  }

  const customerIds = grouped.map((row) => row.customerId);
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, user: { select: { phoneNumber: true } } },
  });
  const phoneByCustomerId = new Map(customers.map((c) => [c.id, c.user.phoneNumber]));

  const items: CustomerRankingItem[] = grouped
    .map((row) => ({
      id: row.customerId,
      phoneNumber: phoneByCustomerId.get(row.customerId) ?? "",
      bookingCount: row._count,
    }))
    .filter((item) => item.phoneNumber !== "");

  return { items };
}

export async function getCustomersAwaitingReviews(): Promise<{ items: CustomerAwaitingReviewItem[]; count: number }> {
  await requireAdmin();

  const where = { bookings: { some: { status: "COMPLETED" as const, review: null } } };

  const [count, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PREVIEW_LIMIT,
      select: { id: true, user: { select: { phoneNumber: true } } },
    }),
  ]);

  return {
    items: customers.map((c) => ({ id: c.id, phoneNumber: c.user.phoneNumber })),
    count,
  };
}
