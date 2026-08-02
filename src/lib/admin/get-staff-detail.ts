import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLastLoginAt } from "./get-last-login";
import type { StaffRole } from "@prisma/client";

// Staff detail — User & Access Management (Batch 6). requireAdmin(). Core Staff
// fields (including the multi-value roles) + derived last-login. No schema field
// is added.

export type StaffDetail = {
  id: string;
  userId: string;
  phoneNumber: string;
  roles: StaffRole[];
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
} | null;

export async function getStaffDetail(staffId: string): Promise<StaffDetail> {
  await requireAdmin();
  if (!isValidUuid(staffId)) return null;

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: { user: { select: { phoneNumber: true, authUserId: true } } },
  });
  if (!staff) return null;

  const lastLoginAt = await getLastLoginAt(staff.user.authUserId);

  return {
    id: staff.id,
    userId: staff.userId,
    phoneNumber: staff.user.phoneNumber,
    roles: staff.roles,
    status: staff.status,
    createdAt: staff.createdAt,
    lastLoginAt,
  };
}
