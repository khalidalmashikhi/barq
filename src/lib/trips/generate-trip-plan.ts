import "server-only";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit/rate-limiter";
import type { Locale } from "@/i18n/locales";
import { parseTripInput, tripDateKeys, type TripInput } from "./trip-input";
import { buildTripDay, buildTripPlan } from "./trip-planner";
import { getTripCandidates } from "./trip-candidates";
import { getTripPlannerModel } from "./trip-planner-model";
import { TRIP_PERIODS, type TripDay, type TripPlan } from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation. The ONE application service behind the web page
// and `/api/v1/trips/plan` (ADR-0011): parse → read real candidates → plan. Stateless: nothing is
// stored, so no plan can be read by another customer (persistence — SAVED / ARCHIVED, sharing — is
// a later, separately-approved phase with its own migration). Deterministic: the same request gives
// the same plan, so a reload or a double tap never produces a different (or paid) result.
//
// Logging: outcome category, counts and timing only — never the region/date/party preferences as a
// profile, never a prompt or model output (none exists in this phase).

export const TRIP_PLAN_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 } as const;

export type GenerateTripPlanResult =
  | { ok: true; plan: TripPlan }
  | { ok: true; day: TripDay }
  | { ok: false; code: "INVALID_INPUT"; fields: string[] }
  | { ok: false; code: "RATE_LIMITED"; retryAfterSeconds: number }
  | { ok: false; code: "FAILED_RETRYABLE" };

export type GenerateTripPlanRequest = {
  input: unknown;
  locale: Locale;
  /** Opaque, already-hashed requester key (session user id or HMAC of the client IP). */
  requesterKey: string;
  /** Regenerate only this day (1-based), keeping every other day's services out of it. */
  regenerateDay?: number;
  /** The services currently placed on the OTHER days (from the customer's plan). */
  keepServiceIds?: string[];
  /** Deterministic alternative ordering for "regenerate". */
  variant?: number;
};

export async function generateTripPlan(req: GenerateTripPlanRequest): Promise<GenerateTripPlanResult> {
  const started = Date.now();
  const parsed = parseTripInput(req.input);
  if (!parsed.ok) return { ok: false, code: "INVALID_INPUT", fields: parsed.fields };
  const input: TripInput = parsed.value;
  if (req.regenerateDay !== undefined && (!Number.isInteger(req.regenerateDay) || req.regenerateDay < 1 || req.regenerateDay > input.days)) {
    return { ok: false, code: "INVALID_INPUT", fields: ["regenerateDay"] };
  }
  const variant = Number.isInteger(req.variant) && req.variant! >= 0 && req.variant! <= 1000 ? req.variant! : 0;
  const keep = (req.keepServiceIds ?? []).filter((id) => typeof id === "string").slice(0, 40);

  const rate = checkRateLimit(`trip-plan:${req.requesterKey}`, TRIP_PLAN_RATE_LIMIT);
  if (!rate.allowed) return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds };

  try {
    const candidates = await getTripCandidates({ regionCode: input.regionCode, dateKeys: tripDateKeys(input), locale: req.locale });
    // Fail-closed model boundary: no adapter exists in this phase (always null). Should one ever be
    // configured without a validated model path, refuse rather than answer unvalidated.
    if (getTripPlannerModel() !== null) {
      logger.warn("trip.plan.failed", { outcome: "MODEL_PATH_NOT_IMPLEMENTED", durationMs: Date.now() - started });
      return { ok: false, code: "FAILED_RETRYABLE" };
    }
    if (req.regenerateDay !== undefined) {
      const day = buildTripDay(input, candidates, req.regenerateDay, { excludeServiceIds: keep, variant });
      logger.info("trip.plan.day_regenerated", { outcome: "OK", candidateCount: candidates.length, days: input.days, durationMs: Date.now() - started });
      return { ok: true, day };
    }
    const plan = buildTripPlan(input, candidates, { variant });
    const barqItems = plan.days.flatMap((d) => TRIP_PERIODS.flatMap((p) => d.periods[p])).filter((i) => i.kind === "BARQ_SERVICE").length;
    logger.info("trip.plan.generated", { outcome: plan.state, source: plan.source, candidateCount: candidates.length, barqItems, days: input.days, durationMs: Date.now() - started });
    return { ok: true, plan };
  } catch {
    logger.warn("trip.plan.failed", { outcome: "FAILED_RETRYABLE", durationMs: Date.now() - started });
    return { ok: false, code: "FAILED_RETRYABLE" };
  }
}
