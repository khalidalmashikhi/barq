import type { HTMLAttributes, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, XCircle } from "lucide-react";
import { clsx } from "./clsx";

// Alert — Phase F.1 (UI/UX Redesign Foundation). Page/section-level
// messages (error, warning, success, info) — distinct from inline
// field validation, per docs/04-experience/DESIGN_SYSTEM.md §8/§11.

type AlertVariant = "info" | "success" | "warning" | "danger";

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
  title?: ReactNode;
};

const variantConfig: Record<AlertVariant, { classes: string; Icon: typeof Info }> = {
  info: { classes: "border-secondary/20 bg-secondary/5 text-secondary-700", Icon: Info },
  success: { classes: "border-success/20 bg-success/5 text-success", Icon: CheckCircle2 },
  warning: { classes: "border-accent/40 bg-accent/10 text-accent-foreground", Icon: AlertCircle },
  danger: { classes: "border-danger/20 bg-danger/5 text-danger", Icon: XCircle },
};

export function Alert({ variant = "info", title, className, children, ...props }: AlertProps) {
  const { classes, Icon } = variantConfig[variant];

  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={clsx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", classes, className)}
      {...props}
    >
      <Icon size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/70">{children}</div>}
      </div>
    </div>
  );
}
