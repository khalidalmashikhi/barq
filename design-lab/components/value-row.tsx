import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import { FOCUS_RING, TONE } from "../tokens";

// Proposed review rows (inside a SectionCard — never a card per field).
//
// ValueRow: label, the value as text, where it came from, ONE action. "Needs review" = amber edge + the
// word in the source line; "missing" = red edge.
//
// SensitiveDataRow: a PRIVATE value (plate, VIN, owner name …) shown MASKED by default; "Show" reveals it
// in place for this view only (state never leaves the component, nothing is logged). Stories use
// synthetic values only.

type RowState = "default" | "review" | "missing";

const ACTION = `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[1rem] font-semibold text-primary underline underline-offset-4 hover:bg-[#EEF4F8] ${FOCUS_RING}`;

function RowShell({ label, state, source, action, children }: { label: ReactNode; state: RowState; source?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={clsx("flex flex-col gap-1", state !== "default" && TONE[state === "review" ? "review" : "missing"].edge)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="text-[1rem] leading-[1.6] text-foreground/70">{label}</span>
        {action}
      </div>
      {children}
      {source && <p className={clsx("text-[0.9375rem] leading-[1.5]", state === "review" ? TONE.review.text : state === "missing" ? TONE.missing.text : "text-foreground/70")}>{source}</p>}
    </div>
  );
}

export function ValueRow({ label, value, placeholder, state = "default", source, actionLabel, onAction, valueDir }: { label: ReactNode; value?: ReactNode; placeholder?: ReactNode; state?: RowState; source?: ReactNode; actionLabel?: ReactNode; onAction?: () => void; valueDir?: "ltr" }) {
  return (
    <RowShell
      label={label}
      state={state}
      source={source}
      action={
        actionLabel ? (
          <button type="button" onClick={onAction} className={ACTION}>
            {actionLabel}
          </button>
        ) : null
      }
    >
      {value ? (
        <span dir={valueDir} className={clsx("text-[1.125rem] font-semibold leading-[1.5]", valueDir === "ltr" && "self-start text-start")}>
          {value}
        </span>
      ) : (
        <span className="text-[1.125rem] font-medium leading-[1.5] text-foreground/70">{placeholder}</span>
      )}
    </RowShell>
  );
}

export function SensitiveDataRow({ label, maskedValue, value, showLabel, hideLabel, state = "default", source, actionLabel, onAction }: { label: ReactNode; maskedValue: string; value: string; showLabel: string; hideLabel: string; state?: RowState; source?: ReactNode; actionLabel?: ReactNode; onAction?: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <RowShell
      label={label}
      state={state}
      source={source}
      action={
        <span className="flex items-center gap-1">
          <button type="button" aria-pressed={shown} onClick={() => setShown((s) => !s)} className={ACTION}>
            {shown ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
            {shown ? hideLabel : showLabel}
          </button>
          {actionLabel && (
            <button type="button" onClick={onAction} className={ACTION}>
              {actionLabel}
            </button>
          )}
        </span>
      }
    >
      <span dir="ltr" className="self-start text-[1.125rem] font-semibold tracking-wide">
        {shown ? value : maskedValue}
      </span>
    </RowShell>
  );
}
