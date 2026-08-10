import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLastLoginAt } from "./get-last-login";

// Administrator detail — User & Access Management (Batch 6). requireAdmin().
// Core Admin fields + derived last-login + derived "granted by".
//
// GRANTED BY: derived from the earliest `admin.granted` audit event for this
// admin, resolving its actorId (the granting Admin's id) to that admin's phone.
// `grantedByPhone` is null when no such event exists (a legacy admin created
// before access auditing) OR the grantor can't be resolved — the caller then
// shows the localized "Unknown — created before access auditing" fallback. No
// Admin.createdByAdminId schema field is added.

export type AdminDetail = {
  id: string;
  userId: string;
  phoneNumber: string | null;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  grantedByPhone: string | null;
} | null;

export async function getAdminDetail(adminId: string): Promise<AdminDetail> {
  await requireAdmin();
  if (!isValidUuid(adminId)) return null;

  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    include: { user: { select: { phoneNumber: true, authUserId: true } } },
  });
  if (!admin) return null;

  const lastLoginAt = await getLastLoginAt(admin.user.authUserId);

  const grant = await prisma.auditLog.findFirst({
    where: { entityType: "Admin", entityId: adminId, action: "admin.granted" },
    orderBy: { createdAt: "asc" },
    select: { actorId: true },
  });

  let grantedByPhone: string | null = null;
  if (grant?.actorId) {
    const grantor = await prisma.admin.findUnique({
      where: { id: grant.actorId },
      include: { user: { select: { phoneNumber: true } } },
    });
    grantedByPhone = grantor?.user.phoneNumber ?? null;
  }

  return {
    id: admin.id,
    userId: admin.userId,
    phoneNumber: admin.user.phoneNumber,
    status: admin.status,
    createdAt: admin.createdAt,
    lastLoginAt,
    grantedByPhone,
  };
}
