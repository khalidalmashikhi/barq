import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import { TEXT, type ForcedState } from "../tokens";

// Proposed Field: label above, 52 px input, 18 px value, one helper line. States: default · focus ·
// needs review (a suggestion from the document — amber, with the word) · error (red, with the word and
// aria-invalid) · disabled. Numbers, plates and dates pass `valueDir="ltr"` so digits never reorder in RTL.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  review?: ReactNode;
  valueDir?: "ltr" | "auto";
  forceState?: ForcedState;
};

export function Field({ label, hint, error, review, valueDir = "auto", required, disabled, forceState, className, ...input }: Props) {
  const id = useId();
  const helpId = `${id}-help`;
  const helper = error ?? review ?? hint;
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className={clsx(TEXT.label, "flex items-center gap-1.5")}>
        {label}
        {required && (
          <span aria-hidden className="text-[#B91C1C]">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        {...input}
        required={required}
        disabled={disabled}
        dir={valueDir}
        aria-invalid={error ? true : undefined}
        aria-describedby={helper ? helpId : undefined}
        data-force={forceState}
        className={clsx(
          "min-h-[3.25rem] w-full rounded-xl border-[1.5px] bg-card px-3.5 text-[1.125rem] text-foreground placeholder:text-foreground/50",
          "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25",
          "data-[force=focus]:border-primary data-[force=focus]:ring-[3px] data-[force=focus]:ring-primary/25 data-[force=hover]:border-foreground/40 hover:border-foreground/40",
          error ? "border-[#B91C1C]" : review ? "border-warning bg-[#FFFDF7]" : "border-foreground/20",
          disabled && "cursor-not-allowed border-border bg-[#F1F4F7] text-foreground/60",
          valueDir === "ltr" && "text-end",
        )}
      />
      {helper && (
        <p id={helpId} className={clsx("flex items-start gap-1.5 text-[0.9375rem] leading-[1.5]", error ? "text-[#B91C1C]" : review ? "text-[#7A4A00]" : "text-foreground/70")}>
          {error ? <XCircle size={16} aria-hidden className="mt-0.5 shrink-0" /> : review ? <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" /> : null}
          <span>{helper}</span>
        </p>
      )}
    </div>
  );
}
