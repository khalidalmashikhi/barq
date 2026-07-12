import "server-only";
import type { ServiceStatus } from "@prisma/client";

// Service status presentation — Provider Dashboard Phase 1b.
//
// Same established idiom as src/lib/booking/booking-status.ts:
// exhaustive Record<ServiceStatus, string> keyed by the real generated
// enum (type-only import — erased before bundling, no client/server
// bundling risk regardless of consumer), exported functions accept a
// plain string so any current/future caller's DTO typing isn't forced
// narrower than it already is.
//
// Placed under src/lib/services/presentation/ (not directly in
// src/lib/services/), per explicit instruction — ServiceStatus
// belongs to the Services bounded context, not Provider's own, so a
// future non-Provider consumer could reuse this without any
// Provider-specific coupling. The "presentation/" segment mirrors
// Provider's own "queries/" segment — a label/style module is a
// presentation concern, not a query.

const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشورة",
  PAUSED: "متوقفة مؤقتاً",
  ARCHIVED: "مؤرشفة",
};

const SERVICE_STATUS_STYLES: Record<ServiceStatus, string> = {
  DRAFT: "bg-accent/20 text-accent-foreground",
  PUBLISHED: "bg-success/10 text-success",
  PAUSED: "bg-secondary/15 text-secondary",
  ARCHIVED: "bg-foreground/10 text-foreground/50",
};

const FALLBACK_STYLE = "bg-accent/20 text-accent-foreground";

export function getServiceStatusLabel(status: string): string {
  return SERVICE_STATUS_LABELS[status as ServiceStatus] ?? status;
}

export function getServiceStatusStyle(status: string): string {
  return SERVICE_STATUS_STYLES[status as ServiceStatus] ?? FALLBACK_STYLE;
}
