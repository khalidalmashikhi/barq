"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AvailabilityActionErrorCode } from "./availability-action-errors";

// Bulk-create Availability Slots — Phase 4.2 (Provider Experience),
// Priority 2's "Bulk actions where appropriate". The single most
// useful recurring pattern for a tourism provider: the same time-of-day
// window, repeated once per day across a date range (e.g. "9am-12pm,
// every day this month") — not a full recurrence-rule engine
// (specific weekdays, exceptions, etc.), which would be real scope
// creep beyond what this phase asked for.
//
// Capped at MAX_DAYS to prevent an accidental huge batch (a typo'd
// year in the end date should not silently create thousands of rows).
// Every slot in the batch is created in one $transaction — either the
// whole batch succeeds or none of it does, so a partial/inconsistent
// batch can never exist.

export type BulkCreateAvailabilityResult =
  | { ok: true; createdCount: number }
  | { ok: false; error: AvailabilityActionErrorCode };

const MAX_DAYS = 60;

function combineDateAndTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}`);
}

export async function createAvailabilitySlotsBulk(formData: FormData): Promise<BulkCreateAvailabilityResult> {
  const serviceId = formData.get("serviceId");
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  const startTimeOfDay = formData.get("startTimeOfDay");
  const endTimeOfDay = formData.get("endTimeOfDay");
  const capacityRaw = formData.get("capacity");

  if (
    typeof serviceId !== "string" ||
    typeof startDate !== "string" ||
    typeof endDate !== "string" ||
    typeof startTimeOfDay !== "string" ||
    typeof endTimeOfDay !== "string" ||
    typeof capacityRaw !== "string" ||
    !isValidUuid(serviceId)
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const capacity = Number.parseInt(capacityRaw, 10);
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const rangeStart = new Date(`${startDate}T00:00:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeEnd < rangeStart) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const dayCount = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (dayCount > MAX_DAYS) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const slotDates: string[] = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    slotDates.push(d.toISOString().slice(0, 10));
  }

  const slots = slotDates.map((dateStr) => ({
    startTime: combineDateAndTime(dateStr, startTimeOfDay),
    endTime: combineDateAndTime(dateStr, endTimeOfDay),
  }));

  const now = new Date();
  if (slots.some(({ startTime, endTime }) => Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime || startTime <= now)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const service = await prisma.service.findFirst({ where: { id: serviceId, providerId: provider.id } });

    if (!service) {
      return { ok: false, error: "SERVICE_NOT_FOUND" };
    }

    await prisma.$transaction([
      ...slots.map(({ startTime, endTime }) =>
        prisma.availability.create({ data: { serviceId, startTime, endTime, capacity } })
      ),
      // One summary audit event for the whole batch, not one per slot —
      // this is a single bulk action, not N separate ones. serviceId is
      // the batch's anchor entity since no single Availability row
      // represents "the whole batch."
      recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "availability.bulk_created",
          entityType: "Availability",
          entityId: serviceId,
          newValue: { count: slots.length, capacity, startDate, endDate },
        },
        prisma
      ),
    ]);

    return { ok: true, createdCount: slots.length };
  } catch (error) {
    logger.error("createAvailabilitySlotsBulk.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
