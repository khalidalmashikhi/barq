import type { HTMLAttributes } from "react";
import { clsx } from "./clsx";

// Badge — Phase F.1 (UI/UX Redesign Foundation). Small status/label
// indicator, using the same semantic color roles already established
// in tailwind.config.ts (primary/secondary/accent/success/danger) —
// no new colors introduced.

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-accent/15 text-accent-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-accent/25 text-accent-foreground",
  danger: "bg-danger/10 text-danger",
  info: "bg-secondary/10 text-secondary-700",
};

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
