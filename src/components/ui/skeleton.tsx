import type { HTMLAttributes } from "react";
import { clsx } from "./clsx";

// Skeleton — Phase F.1 (UI/UX Redesign Foundation). Names a pattern
// (`animate-pulse rounded-* bg-accent/10`) already used ad hoc, inline,
// in several loading.tsx files across the app — a single reusable
// primitive instead of the same three classes retyped per screen.
// Respects prefers-reduced-motion via globals.css's existing
// blanket animation-duration override — no separate handling needed
// here.

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={clsx("animate-pulse rounded-xl bg-accent/10", className)} {...props} />;
}
