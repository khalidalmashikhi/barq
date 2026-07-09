import { forwardRef, type ButtonHTMLAttributes } from "react";
import { clsx } from "./clsx";

// Button — Visual Identity Sprint.
//
// Pure presentational component — no auth calls, no business logic.
// Existing usages (login-form.tsx, logout-button.tsx) wrap their own
// authClient calls around this; this component never contains them.

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline-light";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-primary",
  secondary:
    "bg-secondary text-secondary-foreground hover:opacity-90 focus-visible:ring-secondary",
  ghost:
    "bg-transparent text-foreground border border-border hover:bg-accent focus-visible:ring-primary",
  // For use on dark backgrounds (e.g. the dashboard's gradient header) —
  // a real variant, not a className override colliding with `ghost`'s
  // own border/text classes, which clsx (this project's minimal
  // className joiner, not a real Tailwind-conflict resolver) cannot
  // safely arbitrate. See clsx.ts's own documented limitation.
  "outline-light":
    "bg-transparent text-white border border-white/30 hover:bg-white/10 focus-visible:ring-white",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      className,
      disabled,
      children,
      ...props
    }: ButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>
  ) => {
    const resolvedVariant: ButtonVariant = variant ?? "primary";
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={clsx(
          "inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium",
          "transition-all duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          variantClasses[resolvedVariant],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
