"use client";

import type { ButtonHTMLAttributes } from "react";
import { clsx } from "./clsx";

// Chip — Phase F.1 (UI/UX Redesign Foundation). Selectable filter
// pill (category filters, tag selection) — distinct from Badge (a
// static label, never interactive).

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
};

export function Chip({ selected = false, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium",
        "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground/70 hover:border-primary/40 hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
