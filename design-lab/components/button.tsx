import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clsx } from "@/components/ui/clsx";
import { FOCUS_RING, type ForcedState } from "../tokens";

// Proposed shared Button. One filled primary per screen; secondary is outlined; tertiary is a text
// action ("enter manually", "save for later"). Disabled is SOLID grey with the reason underneath
// (aria-describedby) — never only a faded button. Loading keeps the label, shows a spinner and ignores
// taps (aria-busy), so a second tap cannot send a second request.

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
  loadingLabel?: ReactNode;
  /** Shown under the button while it is disabled, and announced with it. */
  disabledReason?: ReactNode;
  icon?: ReactNode;
  fullWidth?: boolean;
  forceState?: ForcedState;
  children: ReactNode;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-[#073652] active:bg-[#062F49] data-[force=hover]:bg-[#073652] data-[force=pressed]:bg-[#062F49]",
  secondary: "border-[1.5px] border-primary/25 bg-card text-primary hover:bg-[#EEF4F8] active:bg-[#DBE7EF] data-[force=hover]:bg-[#EEF4F8] data-[force=pressed]:bg-[#DBE7EF]",
  tertiary: "bg-transparent px-2 text-primary underline underline-offset-[5px] hover:bg-[#EEF4F8] active:bg-[#DBE7EF] data-[force=hover]:bg-[#EEF4F8] data-[force=pressed]:bg-[#DBE7EF]",
  destructive: "bg-[#B91C1C] text-white hover:bg-[#991B1B] active:bg-[#7F1D1D] data-[force=hover]:bg-[#991B1B] data-[force=pressed]:bg-[#7F1D1D]",
};

export function Button({ variant = "primary", size = "md", loading = false, loadingLabel, disabled, disabledReason, icon, fullWidth, forceState, className, children, ...rest }: Props) {
  const reasonId = useId();
  const isDisabled = disabled || loading;
  const showReason = disabled && !loading && disabledReason;
  return (
    <span className={clsx("inline-flex flex-col items-stretch gap-1.5", fullWidth && "w-full")}>
      <button
        type="button"
        {...rest}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-describedby={showReason ? reasonId : undefined}
        data-force={forceState}
        className={clsx(
          "inline-flex items-center justify-center gap-2 whitespace-normal rounded-2xl text-center font-semibold transition-colors",
          size === "md" ? "min-h-[3.25rem] px-5 text-[1.0625rem]" : "min-h-11 px-4 text-[1rem]",
          VARIANT[variant],
          FOCUS_RING,
          "data-[force=focus]:outline-none data-[force=focus]:ring-[3px] data-[force=focus]:ring-primary/40 data-[force=focus]:ring-offset-2",
          disabled && !loading && "cursor-not-allowed !border-transparent !bg-[#E5E9EE] !text-[#475569] !no-underline",
          loading && "cursor-progress",
          fullWidth && "w-full",
          className,
        )}
      >
        {loading ? <span aria-hidden className="size-[1.125rem] shrink-0 animate-spin rounded-full border-[2.5px] border-current border-t-transparent" /> : icon}
        <span>{loading && loadingLabel ? loadingLabel : children}</span>
      </button>
      {showReason && (
        // `ds-bar-reason`: inside a sticky bar in large-text mode A this stays announced but is shown in
        // the page's action area instead (design-lab/lab.css).
        <span id={reasonId} className="ds-bar-reason text-center text-[0.9375rem] leading-[1.5] text-foreground/70">
          {disabledReason}
        </span>
      )}
    </span>
  );
}
