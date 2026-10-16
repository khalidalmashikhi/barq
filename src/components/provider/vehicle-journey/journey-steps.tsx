"use client";

import { AlertTriangle, Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { journeyStepStates, type JourneyProgress, type JourneyStepState } from "./journey-progress";
import { useJourneyStatus } from "./journey-status";

export type { JourneyProgress, JourneyStep } from "./journey-progress";

// 2026-10-16 — the compact four-step header of the document-first vehicle journey:
//   1 upload document · 2 read details · 3 review details · 4 create vehicle
// An ordered list inside a labelled <nav>; the current step carries aria-current="step". Every
// non-upcoming state is told apart by SHAPE and by announced text, never by colour alone:
//   completed — teal disc + check, announced "done" (the provider finished the step — it never
//               means that BARQ verified the document);
//   current   — navy disc + number + ring, bold label;
//   error     — amber ring + warning mark, announced "reading unsuccessful" (never a check);
//   skipped   — dashed ring + dash, announced "not read — entered manually";
//   upcoming  — outlined number.
// The state comes from the pure journeyStepStates() contract; on the "read details" page a failure
// inside the consent step flips step 2 to current + error through the client-only journey status.
// Logical start/end connectors mirror Arabic (RTL) and English (LTR); fits a 375 px screen.

const STEP_KEYS = ["vehicleJourneyStep1", "vehicleJourneyStep2", "vehicleJourneyStep3", "vehicleJourneyStep4"] as const;

/** Announced after the step name (assistive technology only) — the visible mark carries the same meaning. */
const STATUS_TEXT_KEY: Partial<Record<JourneyStepState["status"], string>> = {
  completed: "vehicleJourneyStepDone",
  error: "vehicleJourneyStepFailed",
  skipped: "vehicleJourneyStepNotRead",
};

export function VehicleJourneySteps({ progress }: { progress: JourneyProgress }) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const live = useJourneyStatus();
  const effective: JourneyProgress = progress.stage === "read" && live?.readingFailed ? { stage: "read", failed: true } : progress;
  const states = journeyStepStates(effective);
  const now = states.find((x) => x.current)!;
  const nowStatusKey = STATUS_TEXT_KEY[now.status];
  return (
    // `journey-steps` is a size container (globals.css): when four labels cannot fit the width at the
    // provider's text size, they are visually hidden (still announced) and ONE "Step n of 4" line shows.
    <nav aria-label={t("vehicleJourneyStepsLabel")} className="journey-steps text-xs">
      <ol className="grid grid-cols-4">
        {states.map(({ step, status, current }, i) => {
          const prevCompleted = i > 0 && states[i - 1]!.status === "completed";
          const statusKey = STATUS_TEXT_KEY[status];
          return (
            <li key={step} aria-current={current ? "step" : undefined} data-step-state={status} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <span className="relative flex h-8 w-full items-center justify-center">
                {i > 0 && <span aria-hidden className={`absolute start-0 end-1/2 top-1/2 h-0.5 -translate-y-1/2 ${prevCompleted ? "bg-secondary" : "bg-border"}`} />}
                {i < states.length - 1 && <span aria-hidden className={`absolute start-1/2 end-0 top-1/2 h-0.5 -translate-y-1/2 ${status === "completed" ? "bg-secondary" : "bg-border"}`} />}
                <span aria-hidden className={`relative z-10 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${CIRCLE[status]} ${current ? (status === "error" ? "ring-4 ring-warning/25" : "ring-4 ring-primary/15") : ""}`}>
                  {status === "completed" ? (
                    <Check size={16} strokeWidth={2.5} />
                  ) : status === "error" ? (
                    <AlertTriangle size={15} strokeWidth={2.25} />
                  ) : status === "skipped" ? (
                    <Minus size={16} strokeWidth={2.5} />
                  ) : (
                    step
                  )}
                </span>
              </span>
              <span className={`journey-steps-label px-0.5 text-xs leading-tight ${LABEL[status]} ${current ? "font-semibold" : ""}`}>
                {t(STEP_KEYS[i]!)}
                {statusKey && <span className="sr-only"> — {td(statusKey)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Compact mode only (very large text): the list above still carries every step for assistive technology. */}
      <p aria-hidden className="journey-steps-compact mt-2 text-center text-sm font-semibold text-primary">
        {td("vehicleJourneyStepOf", { step: now.step, name: t(STEP_KEYS[now.step - 1]!) })}
        {nowStatusKey && now.status !== "completed" ? ` — ${td(nowStatusKey)}` : ""}
      </p>
    </nav>
  );
}

const CIRCLE: Record<JourneyStepState["status"], string> = {
  completed: "bg-secondary text-white",
  current: "bg-primary text-primary-foreground",
  error: "border-2 border-warning bg-warning/15 text-foreground",
  skipped: "border-2 border-dashed border-foreground/30 bg-card text-foreground/70",
  upcoming: "border border-foreground/20 bg-card text-foreground/60",
};

const LABEL: Record<JourneyStepState["status"], string> = {
  completed: "text-foreground/80",
  current: "text-primary",
  error: "text-foreground",
  skipped: "text-foreground/70",
  upcoming: "text-foreground/60",
};
