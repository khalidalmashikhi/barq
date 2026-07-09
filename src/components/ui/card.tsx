import type { HTMLAttributes } from "react";
import { clsx } from "./clsx";

// Card — Visual Identity Sprint. Pure presentational shell, no data
// fetching, no business logic — every current usage (login, dashboard)
// passes its own content as children.

type CardProps = HTMLAttributes<HTMLDivElement> & {
  hoverLift?: boolean;
};

export function Card({ className, hoverLift = false, children, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-border bg-card p-6 shadow-sm",
        hoverLift && "transition-transform duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
