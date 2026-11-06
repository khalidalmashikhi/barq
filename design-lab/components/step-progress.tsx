import { AlertTriangle } from "lucide-react";
import { clsx } from "@/components/ui/clsx";

// Proposed StepProgress: a segmented bar + ONE line "Step n of N: name" (never four labels that wrap at
// 375 px). Every step is still in an ordered list for assistive technology, with its state announced —
// done / current / reading unsuccessful — so state is never colour-only.

export type StepStatus = "done" | "current" | "error" | "upcoming";

type Props = {
  label: string;
  steps: { name: string; status: StepStatus }[];
  /** e.g. (n, total, name) => `Step ${n} of ${total}: ${name}` — from the existing `vehicleJourneyStepOf` key. */
  summary: (step: number, total: number, name: string) => string;
  statusText: Partial<Record<StepStatus, string>>;
};

const SEGMENT: Record<StepStatus, string> = {
  done: "bg-secondary",
  current: "bg-primary",
  error: "bg-warning",
  upcoming: "bg-foreground/10",
};

export function StepProgress({ label, steps, summary, statusText }: Props) {
  const currentIndex = Math.max(0, steps.findIndex((s) => s.status === "current" || s.status === "error"));
  const current = steps[currentIndex]!;
  return (
    <nav aria-label={label} className="flex flex-col gap-2">
      <div aria-hidden className="flex gap-1.5">
        {steps.map((s, i) => (
          <span key={i} className={clsx("h-1.5 flex-1 rounded-full", SEGMENT[s.status])} />
        ))}
      </div>
      <p aria-hidden className="flex items-center gap-1.5 text-[0.9375rem] leading-[1.5] text-foreground/70">
        {current.status === "error" && <AlertTriangle className="ds-icon-sm shrink-0 text-[#7A4A00]" />}
        <span>
          {summary(currentIndex + 1, steps.length, "")}
          <b className="font-semibold text-foreground">{current.name}</b>
          {current.status === "error" && statusText.error ? <span className="text-[#7A4A00]"> — {statusText.error}</span> : null}
        </span>
      </p>
      <ol className="sr-only">
        {steps.map((s, i) => (
          <li key={i} aria-current={i === currentIndex ? "step" : undefined}>
            {s.name}
            {statusText[s.status] ? ` — ${statusText[s.status]}` : ""}
          </li>
        ))}
      </ol>
    </nav>
  );
}
