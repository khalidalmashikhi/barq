import "server-only";
import type { TripModelRequest } from "./trip-model-contract";

// 2026-10-17 — Trip planner, grounded foundation. The ISOLATED provider boundary for a future
// model-assisted plan — FAIL-CLOSED: in this phase no adapter exists, so getTripPlannerModel()
// returns null for every configuration and generateTripPlan() uses the deterministic planner.
// No network call, no key read, no prompt exists in this phase.
//
// Enabling a model later is a SEPARATE, owner-approved phase (ADR-0008 AI boundaries; roadmap
// Phase 8 exception) and needs, at minimum:
//   TRIP_PLANNER_AI_PROVIDER   an approved provider id (adapter + data-processing terms reviewed)
//   TRIP_PLANNER_AI_API_KEY    a DEDICATED key — never the registration-reading credential
//   TRIP_PLANNER_AI_MODEL      an allow-listed model id
//   call budget, timeout, output-token cap and per-customer rate limit configuration
//   an AuditLog record per AI action (actor, timestamp, reason, confidence, trace + correlation id)
// The adapter would receive ONLY a TripModelRequest (anonymous options, party counts) and its
// answer must pass validateTripModelOutput() before anything reaches a customer.

export interface TripPlannerModel {
  /** Propose a plan for the anonymous request. The raw answer is UNTRUSTED (validated by the caller). */
  proposePlan(request: TripModelRequest, signal: AbortSignal): Promise<unknown>;
}

/** Env names a later phase would read (documented here; NOT read in this phase). */
export const TRIP_PLANNER_AI_CONFIG = ["TRIP_PLANNER_AI_PROVIDER", "TRIP_PLANNER_AI_API_KEY", "TRIP_PLANNER_AI_MODEL"] as const;

/** Always null in this phase — the deterministic planner is the only path. */
export function getTripPlannerModel(): TripPlannerModel | null {
  return null;
}
