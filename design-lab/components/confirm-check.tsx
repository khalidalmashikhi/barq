import { useId, type ReactNode } from "react";
import { clsx } from "@/components/ui/clsx";

// Proposed ConfirmCheck: the whole row is the tap target; 26 px box; the label is the full sentence the
// provider confirms (for the consent step: the pinned owner/authorized attestation, verbatim).

export function ConfirmCheck({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={clsx("flex cursor-pointer items-start gap-3 rounded-xl p-1 text-[1.0625rem] leading-[1.65] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/40", disabled && "cursor-not-allowed opacity-70")}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-[1.625rem] shrink-0 accent-primary focus-visible:outline-none" />
      <span>{children}</span>
    </label>
  );
}
