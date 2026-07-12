import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { clsx } from "./clsx";

// EmptyState — AppShell Migration (Stabilization).
//
// Single shared component for the "dashed border, muted icon, message,
// optional description, optional CTA" pattern already used identically
// (copy-pasted as raw JSX) across bookings/page.tsx, services/page.tsx,
// and multiple dashboard sections — per PROJECT_RULES.md §22.
//
// SCOPE, DELIBERATE: only 2 existing usages were migrated onto this
// component in this task (FavoritesSection — no-CTA shape;
// bookings/page.tsx's zero-bookings state — with-CTA shape), enough to
// validate both shapes the component needs to support. Every other
// existing empty state (RecommendedSection, ActivityFeed, dashboard's
// inline Featured/Most-Booked states, services/page.tsx's states,
// bookings/page.tsx's out-of-range-page state) is intentionally left
// untouched — a repo-wide empty-state refactor was explicitly out of
// this task's scope.
//
// `icon` is a plain Lucide component reference (not a pre-rendered
// element, unlike AppSidebar's nav items) — every current and migrated
// usage renders this from a Server Component into another Server
// Component (never crossing into a "use client" boundary), matching
// the exact pattern StatCard already uses safely today.
//
// SPACING/TEXT-SIZE ARE EXPLICIT PROPS, NOT className OVERRIDES:
// the two real usages migrated in this task have genuinely different
// existing spacing (dashboard: gap-2/py-10/text-sm; bookings:
// gap-3/py-16/no explicit text size) — this project's own clsx utility
// deliberately does not resolve conflicting Tailwind classes (see its
// own doc comment), so overriding gap/padding/text-size via a bare
// className string would risk an unpredictable double-class output.
// Discrete props sidestep that entirely. Defaults match the more
// common (dashboard) shape; the bookings call site overrides them
// explicitly to reproduce its own existing look exactly.

type EmptyStateProps = {
  icon: LucideIcon;
  iconSize?: number;
  message: string;
  messageClassName?: string;
  description?: string;
  action?: ReactNode;
  gap?: string;
  padding?: string;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  iconSize = 28,
  message,
  messageClassName = "text-sm text-foreground/50",
  description,
  action,
  gap = "gap-2",
  padding = "py-10",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center rounded-2xl border border-dashed border-border text-center",
        gap,
        padding,
        className
      )}
    >
      <Icon size={iconSize} strokeWidth={1.5} className="text-foreground/25" />
      <p className={messageClassName}>{message}</p>
      {description && <p className="text-xs text-foreground/40">{description}</p>}
      {action}
    </div>
  );
}
