"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

// 2026-10-16 — the compact four-step header of the document-first vehicle journey:
//   1 upload document · 2 read details · 3 review details · 4 create vehicle
// An ordered list inside a labelled <nav>; the current step carries aria-current="step"; a completed
// step shows a check and says "done" to assistive technology — it only means the provider finished
// that step (e.g. uploaded), never that BARQ verified the document. Logical start/end connectors, so
// Arabic reads right-to-left and English left-to-right with no extra code; fits a 375 px screen.

export type JourneyStep = 1 | 2 | 3 | 4;

const STEP_KEYS = ["vehicleJourneyStep1", "vehicleJourneyStep2", "vehicleJourneyStep3", "vehicleJourneyStep4"] as const;

export function VehicleJourneySteps({ current }: { current: JourneyStep }) {
  const t = useTranslations("provider");
  return (
    <nav aria-label={t("vehicleJourneyStepsLabel")}>
      <ol className="grid grid-cols-4">
        {STEP_KEYS.map((key, i) => {
          const n = (i + 1) as JourneyStep;
          const done = n < current;
          const now = n === current;
          const reached = n <= current;
          return (
            <li key={key} aria-current={now ? "step" : undefined} data-step-state={now ? "current" : done ? "done" : "upcoming"} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <span className="relative flex h-8 w-full items-center justify-center">
                {i > 0 && <span aria-hidden className={`absolute start-0 end-1/2 top-1/2 h-0.5 -translate-y-1/2 ${reached ? "bg-secondary" : "bg-border"}`} />}
                {i < STEP_KEYS.length - 1 && <span aria-hidden className={`absolute start-1/2 end-0 top-1/2 h-0.5 -translate-y-1/2 ${done ? "bg-secondary" : "bg-border"}`} />}
                <span
                  aria-hidden
                  className={`relative z-10 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${
                    now ? "bg-primary text-primary-foreground ring-4 ring-primary/15" : done ? "bg-secondary text-white" : "border border-foreground/20 bg-card text-foreground/60"
                  }`}
                >
                  {done ? <Check size={16} strokeWidth={2.5} /> : n}
                </span>
              </span>
              <span className={`px-0.5 text-xs leading-tight ${now ? "font-semibold text-primary" : done ? "text-foreground/80" : "text-foreground/60"}`}>
                {t(key)}
                {done && <span className="sr-only"> — {t("vehicleJourneyStepDone")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
