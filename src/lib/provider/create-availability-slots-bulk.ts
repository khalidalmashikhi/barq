"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { omanLocalToUtc } from "@/lib/date/oman-time";
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

// A calendar date ("YYYY-MM-DD") + a time-of-day ("HH:mm") → the correct UTC
// instant, interpreting the pair as Asia/Muscat wall-clock (not server-local).
function combineDateAndTime(dateStr: string, timeStr: string): Date | null {
  return omanLocalToUtc(`${dateStr}T${timeStr}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Parse a date-only "YYYY-MM-DD" as a UTC midnight epoch, used ONLY for
// runtime-timezone-independent day counting / date-string generation (never
// persisted). The explicit "Z" pins it to UTC regardless of the server zone.
function dateOnlyToUtcMidnightMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
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

  const rangeStartMs = dateOnlyToUtcMidnightMs(startDate);
  const rangeEndMs = dateOnlyToUtcMidnightMs(endDate);

  if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeEndMs < rangeStartMs) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const dayCount = Math.round((rangeEndMs - rangeStartMs) / DAY_MS) + 1;
  if (dayCount > MAX_DAYS) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Generate each day's calendar date string from UTC-midnight arithmetic, so the
  // set of days is identical no matter what timezone the server runs in.
  const slotDates: string[] = [];
  for (let i = 0; i < dayCount; i++) {
    slotDates.push(new Date(rangeStartMs + i * DAY_MS).toISOString().slice(0, 10));
  }

  // Resolve every day's Oman-local window to a UTC instant, rejecting the whole
  // batch on any invalid/past slot. The loop narrows each pair to non-null Dates.
  const now = new Date();
  const slots: { startTime: Date; endTime: Date }[] = [];
  for (const dateStr of slotDates) {
    const startTime = combineDateAndTime(dateStr, startTimeOfDay);
    const endTime = combineDateAndTime(dateStr, endTimeOfDay);
    if (!startTime || !endTime || endTime <= startTime || startTime <= now) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    slots.push({ startTime, endTime });
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
