import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import type { StaffStatus, StaffRole } from "@prisma/client";

// Staff list query — User & Access Management (Batch 2). Same shape and
// phone/User-ID search rules as get-admins.ts. Surfaces the multi-value
// `roles` (StaffRole[]) so the list can show each member's role assignments;
// no name/email is stored or searched.
//
// AUTH: requireAdmin().

export type StaffListItem = {
  id: string;
  userId: string;
  phoneNumber: string;
  roles: StaffRole[];
  status: string;
  createdAt: Date;
};

export type StaffListFilters = {
  q?: string;
  status?: StaffStatus;
  page?: number;
  pageSize?: number;
};

export type StaffListResult = {
  items: StaffListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getStaff(filters: StaffListFilters = {}): Promise<StaffListResult> {
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

  const [totalCount, staff] = await Promise.all([
    prisma.staff.count({ where }),
    prisma.staff.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { phoneNumber: true } } },
    }),
  ]);

  type StaffRow = { id: string; userId: string; status: string; roles: StaffRole[]; createdAt: Date; user: { phoneNumber: string } };

  const items: StaffListItem[] = (staff as StaffRow[]).map((member) => ({
    id: member.id,
    userId: member.userId,
    phoneNumber: member.user.phoneNumber,
    roles: member.roles,
    status: member.status,
    createdAt: member.createdAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
