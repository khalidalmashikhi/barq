import "server-only";
import type { BookingActorType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Audit Log writer — Phase 5.2 (Production Hardening), Priority 2.
// Mirrors BookingStatusEvent/BookingContractEvent's own append-only
// event-log idiom, generalized for admin/provider mutations that don't
// already have a dedicated event-history model. Booking status changes
// remain fully covered by BookingStatusEvent — this is never called for
// those.
//
// UNLIKE the lifecycle notification hooks (fire-and-forget *after* a
// transaction commits, since a notification failing must never undo an
// already-durable transition), an audit record must be written INSIDE
// the same transaction as the mutation it describes — an audit trail
// that can silently fail to write while the real change succeeds would
// defeat its own purpose. `tx` is required, not optional, to make that
// impossible to get wrong at a call site.

export interface RecordAuditEventParams {
  actorType: BookingActorType;
  /// Null only for SYSTEM-initiated actions.
  actorId: string | null;
  /// Dot-namespaced, stable, e.g. "provider.approved" — see
  /// prisma/schema.prisma's AuditLog model comment for the full
  /// extensibility rationale.
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: Prisma.InputJsonObject;
  newValue?: Prisma.InputJsonObject;
}

// Accepts either a real $transaction callback's `tx`, or the plain
// `prisma` client itself — the latter is needed for callers using the
// array form of $transaction (e.g. create-availability-slots-bulk.ts),
// where every operation, including this one, must be a top-level
// prisma.X.create(...) call rather than a callback with its own `tx`.
// Same DbClient shape already established by transition-booking.ts.
type DbClient = typeof prisma | Prisma.TransactionClient;

export function recordAuditEvent(params: RecordAuditEventParams, tx: DbClient) {
  const { actorType, actorId, action, entityType, entityId, previousValue, newValue } = params;

  return tx.auditLog.create({
    data: {
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      previousValue: previousValue ?? undefined,
      newValue: newValue ?? undefined,
    },
  });
}
