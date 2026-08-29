// Duration presentation helper — PURE and framework-free (no "server-only"), so
// both the server-rendered service detail view and any future client component can
// render a machine-stored minute count without dragging the data layer (Prisma /
// server-only) into their bundle. Kept beside service-info.ts, which re-exports it.
//
// The descriptor is locale-agnostic on purpose: it names an i18n key and carries the
// numeric parts, leaving the actual wording to the translator (never a string built here).

export type DurationDescriptor =
  | { key: "durationDays"; count: number }
  | { key: "durationHours"; count: number }
  | { key: "durationMinutes"; count: number }
  | { key: "durationHoursMinutes"; hours: number; minutes: number };

export function describeDuration(minutes: number): DurationDescriptor {
  if (minutes % 1440 === 0) return { key: "durationDays", count: minutes / 1440 };
  if (minutes < 60) return { key: "durationMinutes", count: minutes };
  if (minutes % 60 === 0) return { key: "durationHours", count: minutes / 60 };
  return { key: "durationHoursMinutes", hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
