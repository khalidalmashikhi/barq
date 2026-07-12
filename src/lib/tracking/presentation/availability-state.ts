import "server-only";
import type { AvailabilitySlotState } from "@prisma/client";

// Availability state presentation — Provider Dashboard Phase 1d.
//
// Same established idiom as src/lib/booking/booking-status.ts and
// src/lib/services/presentation/service-status.ts: exhaustive
// Record<AvailabilitySlotState, string> keyed by the real generated
// enum (type-only import — erased before bundling, no client/server
// bundling risk), exported functions accept a plain string so any
// current/future caller's DTO typing isn't forced narrower than it
// already is.
//
// Placed under src/lib/tracking/presentation/, not Services or
// Provider — Availability belongs to the Tracking bounded context
// (see schema.prisma's own section grouping: Availability sits
// alongside Journey/Route under "TRACKING CONTEXT"), per explicit
// instruction.

const AVAILABILITY_STATE_LABELS: Record<AvailabilitySlotState, string> = {
  OPEN: "متاح",
  BLOCKED: "محظور",
  CANCELLED: "ملغى",
};

const AVAILABILITY_STATE_STYLES: Record<AvailabilitySlotState, string> = {
  OPEN: "bg-success/10 text-success",
  BLOCKED: "bg-secondary/15 text-secondary",
  CANCELLED: "bg-danger/10 text-danger",
};

const FALLBACK_STYLE = "bg-accent/20 text-accent-foreground";

export function getAvailabilityStateLabel(state: string): string {
  return AVAILABILITY_STATE_LABELS[state as AvailabilitySlotState] ?? state;
}

export function getAvailabilityStateStyle(state: string): string {
  return AVAILABILITY_STATE_STYLES[state as AvailabilitySlotState] ?? FALLBACK_STYLE;
}
