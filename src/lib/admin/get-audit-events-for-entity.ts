import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Audit-history read layer — User & Access Management (Batch 6). The first
// UI-facing reader of the write-only AuditLog. Reusable across every admin
// detail surface: filter by entityType + entityId, newest first, safely capped
// (bounded-preview pattern, matching get-customer-detail.ts). requireAdmin().
//
// Surfaces exactly action / actorType / actorId / previousValue / newValue /
// createdAt. No secrets/OTPs/tokens/synthetic emails are involved: AuditLog has
// no such columns, and every writer in this codebase records only status/roles
// snapshots (see recordAuditEvent call sites). actorId is returned raw — no
// friendly actor name is invented, since the data model doesn't carry one.

export type AuditEventItem = {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: Date;
};

const DEFAULT_CAP = 50;

export async function getAuditEventsForEntity(
  entityType: string,
  entityId: string,
  cap: number = DEFAULT_CAP
): Promise<AuditEventItem[]> {
  await requireAdmin();

  // entityId is a @db.Uuid column — guard against a non-UUID crashing the query.
  if (!isValidUuid(entityId)) return [];

  const rows = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: cap,
    select: { id: true, action: true, actorType: true, actorId: true, previousValue: true, newValue: true, createdAt: true },
  });

  return rows as AuditEventItem[];
}
