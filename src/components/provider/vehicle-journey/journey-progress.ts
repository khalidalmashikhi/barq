// 2026-10-16 (correction) — the PURE state contract of the four-step vehicle journey header. The
// header never claims more than happened: "completed" only for a step that really succeeded; a
// failed reading is an ERROR (never a check mark); a reading that did not happen (declined, or not
// analysed) is SKIPPED; and nothing here means that BARQ verified the document.
//
//   upload                                  → 1 current
//   read (consent / reading in progress)    → 1 completed · 2 current
//   read, an attempt failed in this step    → 1 completed · 2 current + error
//   review after a successful reading       → 1 completed · 2 completed · 3 current
//   review after a failed reading (manual)  → 1 completed · 2 error · 3 current
//   review without a reading (declined /    → 1 completed · 2 skipped · 3 current
//     not analysed — manual entry)
//   step 4 (create vehicle) is never reached on these screens — creating leaves for the detail page.

export type JourneyStep = 1 | 2 | 3 | 4;

export type JourneyProgress =
  | { stage: "upload" }
  | { stage: "read"; failed?: boolean }
  | { stage: "review"; reading: "succeeded" | "failed" | "skipped" };

/** Visual / announced state of one step. `current` is separate: the reading step can be current AND in error. */
export type JourneyStepStatus = "completed" | "current" | "error" | "skipped" | "upcoming";
export type JourneyStepState = { step: JourneyStep; status: JourneyStepStatus; current: boolean };

export function journeyStepStates(progress: JourneyProgress): JourneyStepState[] {
  const s = (step: JourneyStep, status: JourneyStepStatus, current = false): JourneyStepState => ({ step, status, current });
  switch (progress.stage) {
    case "upload":
      return [s(1, "current", true), s(2, "upcoming"), s(3, "upcoming"), s(4, "upcoming")];
    case "read":
      return [s(1, "completed"), progress.failed ? s(2, "error", true) : s(2, "current", true), s(3, "upcoming"), s(4, "upcoming")];
    case "review": {
      const reading: JourneyStepStatus = progress.reading === "succeeded" ? "completed" : progress.reading === "failed" ? "error" : "skipped";
      return [s(1, "completed"), s(2, reading), s(3, "current", true), s(4, "upcoming")];
    }
  }
}
