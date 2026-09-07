import "server-only";
import { prisma } from "@/lib/db";
import { requireOwner, sanitizePermissionKeys } from "@/lib/auth";
import type { PermissionKey } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import type { StaffStatus, StaffRole } from "@prisma/client";

// Staff list query — STAFF RBAC (Gate Z-3): the OWNER-only staff-management list. Surfaces
// each member's AUTHORITATIVE permission keys + status + created-by attribution (never
// email/OTP/tokens). AUTH: requireOwner() — staff administration is OWNER-only.

export type StaffListItem = {
  id: string;
  userId: string;
  name: string | null;
  phoneNumber: string;
  roles: StaffRole[];
  permissions: PermissionKey[];
  invitedByAdminId: string | null;
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
  await requireOwner();

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
      include: { user: { select: { phoneNumber: true, name: true } } },
    }),
  ]);

  type StaffRow = {
    id: string;
    userId: string;
    status: string;
    roles: StaffRole[];
    permissions: string[];
    invitedByAdminId: string | null;
    createdAt: Date;
    user: { phoneNumber: string; name: string | null };
  };

  const items: StaffListItem[] = (staff as StaffRow[]).map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    phoneNumber: member.user.phoneNumber,
    roles: member.roles,
    permissions: sanitizePermissionKeys(member.permissions ?? []),
    invitedByAdminId: member.invitedByAdminId,
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
