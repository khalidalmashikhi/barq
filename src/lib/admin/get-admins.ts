import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import type { AdminStatus } from "@prisma/client";

// Admin list query — User & Access Management (Batch 2). Mirrors
// get-customers.ts/get-providers.ts's filters-in/paginated-result-out shape.
//
// Identity is phone-only by design (see get-customers.ts's header): the sole
// real, searchable identifiers are the User's phone number and the User ID.
// No name/email is stored or searched (synthetic Better Auth emails are never
// exposed). User ID search is an exact match, guarded by isValidUuid(), since
// the User.id column is @db.Uuid (a LIKE/contains against it would crash).
//
// AUTH: requireAdmin() — every read here is an admin-management surface.

export type AdminListItem = {
  id: string;
  userId: string;
  phoneNumber: string;
  status: string;
  createdAt: Date;
};

export type AdminListFilters = {
  q?: string;
  status?: AdminStatus;
  page?: number;
  pageSize?: number;
};

export type AdminListResult = {
  items: AdminListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getAdmins(filters: AdminListFilters = {}): Promise<AdminListResult> {
  await requireAdmin();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const clauses = [];
  if (filters.status) clauses.push({ status: filters.status });
  if (filters.q) {
    clauses.push(
      isValidUuid(filters.q)
        ? { OR: [{ user: { phoneNumber: { contains: filters.q } } }, { userId: filters.q }] }
        : { user: { phoneNumber: { contains: filters.q } } }
    );
  }
  const where = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { AND: clauses };

  const [totalCount, admins] = await Promise.all([
    prisma.admin.count({ where }),
    prisma.admin.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { phoneNumber: true } } },
    }),
  ]);

  type AdminRow = { id: string; userId: string; status: string; createdAt: Date; user: { phoneNumber: string } };

  const items: AdminListItem[] = (admins as AdminRow[]).map((admin) => ({
    id: admin.id,
    userId: admin.userId,
    phoneNumber: admin.user.phoneNumber,
    status: admin.status,
    createdAt: admin.createdAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
