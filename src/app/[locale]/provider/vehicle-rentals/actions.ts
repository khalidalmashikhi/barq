"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth";
import {
  createRentalOffering,
  updateRentalOffering,
  publishRentalOffering,
  suspendRentalOffering,
  archiveRentalOffering,
  bulkOpenRentalDays,
  blockRentalDay,
  setDailyOverride,
} from "@/lib/offerings/rental";
import type { RentalOfferingErrorCode } from "@/lib/offerings/rental";
import type { RentalActionResult, RentalCreateActionResult } from "@/lib/offerings/rental/provider/rental-action-result";

// Phase 3C Slice C2d-R1 Checkpoint B — the ONLY workspace mutation surface (Server Actions; no REST /
// /api/v1). Each action is a THIN adapter: it does light server-side shape validation, then calls the
// authoritative C2b-R domain function, which derives the provider from the session (NEVER a client
// providerId) and re-reads ownership / provider status / vertical / offering / Service / Vehicle / day
// / lifecycle state inside its OWN transaction with its own audit. This layer never re-implements,
// widens, or weakens that authorization; it maps the domain result to a small stable code for the UI
// and never leaks raw errors or foreign-resource existence. UnauthenticatedError (thrown by the domain
// identity resolver) → UNAUTHENTICATED; any other throw → UNKNOWN_ERROR (fail closed).

const LIST_PATH = "/[locale]/provider/vehicle-rentals";
const DETAIL_PATH = "/[locale]/provider/vehicle-rentals/[offeringId]";

function revalidateWorkspace(): void {
  revalidatePath(LIST_PATH, "page");
  revalidatePath(DETAIL_PATH, "page");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Run a domain call, mapping its result union + thrown auth error to a stable action result. */
async function runAction(
  fn: () => Promise<{ ok: true; value?: unknown } | { ok: false; error: RentalOfferingErrorCode }>,
): Promise<RentalActionResult> {
  try {
    const result = await fn();
    if (result.ok) {
      revalidateWorkspace();
      return { ok: true };
    }
    return { ok: false, code: result.error };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

export type CreateRentalOfferingActionInput = {
  serviceId: unknown;
  vehicleId: unknown;
  baseDailyAmount: unknown;
  currency: unknown;
  offeringCapacityOverride?: unknown;
};

export async function createRentalOfferingAction(input: CreateRentalOfferingActionInput): Promise<RentalCreateActionResult> {
  if (!isNonEmptyString(input.serviceId) || !isNonEmptyString(input.vehicleId)) return { ok: false, code: "INVALID_INPUT" };
  if (!isNonEmptyString(input.baseDailyAmount) || !isNonEmptyString(input.currency)) return { ok: false, code: "INVALID_INPUT" };
  const override = normalizeCapacityOverride(input.offeringCapacityOverride);
  if (override === "INVALID") return { ok: false, code: "INVALID_CAPACITY_OVERRIDE" };
  try {
    const result = await createRentalOffering({
      serviceId: input.serviceId,
      vehicleId: input.vehicleId,
      baseDailyAmount: input.baseDailyAmount,
      currency: input.currency,
      offeringCapacityOverride: override,
    });
    if (!result.ok) return { ok: false, code: result.error };
    revalidateWorkspace();
    return { ok: true, offeringId: result.value.id };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

export type UpdateRentalOfferingActionInput = {
  offeringId: unknown;
  baseDailyAmount?: unknown;
  currency?: unknown;
  offeringCapacityOverride?: unknown; // undefined = unchanged; null = clear; number = set
};

export async function updateRentalOfferingAction(input: UpdateRentalOfferingActionInput): Promise<RentalActionResult> {
  if (!isNonEmptyString(input.offeringId)) return { ok: false, code: "INVALID_INPUT" };
  const patch: { offeringId: string; baseDailyAmount?: string; currency?: string; offeringCapacityOverride?: number | null } = {
    offeringId: input.offeringId,
  };
  if (input.baseDailyAmount !== undefined) {
    if (!isNonEmptyString(input.baseDailyAmount)) return { ok: false, code: "INVALID_MONEY" };
    patch.baseDailyAmount = input.baseDailyAmount;
  }
  if (input.currency !== undefined) {
    if (!isNonEmptyString(input.currency)) return { ok: false, code: "INVALID_CURRENCY" };
    patch.currency = input.currency;
  }
  if (input.offeringCapacityOverride !== undefined) {
    const override = normalizeCapacityOverride(input.offeringCapacityOverride);
    if (override === "INVALID") return { ok: false, code: "INVALID_CAPACITY_OVERRIDE" };
    patch.offeringCapacityOverride = override;
  }
  return runAction(() => updateRentalOffering(patch));
}

export async function publishRentalOfferingAction(offeringId: unknown): Promise<RentalActionResult> {
  if (!isNonEmptyString(offeringId)) return { ok: false, code: "INVALID_INPUT" };
  return runAction(() => publishRentalOffering(offeringId));
}

export async function suspendRentalOfferingAction(offeringId: unknown): Promise<RentalActionResult> {
  if (!isNonEmptyString(offeringId)) return { ok: false, code: "INVALID_INPUT" };
  return runAction(() => suspendRentalOffering(offeringId));
}

export async function archiveRentalOfferingAction(offeringId: unknown): Promise<RentalActionResult> {
  if (!isNonEmptyString(offeringId)) return { ok: false, code: "INVALID_INPUT" };
  return runAction(() => archiveRentalOffering(offeringId));
}

export type OpenRentalDaysActionInput = { offeringId: unknown; dateKeys: unknown; reopenBlocked?: unknown };

export async function openRentalDaysAction(input: OpenRentalDaysActionInput): Promise<RentalActionResult> {
  if (!isNonEmptyString(input.offeringId)) return { ok: false, code: "INVALID_INPUT" };
  if (!Array.isArray(input.dateKeys) || input.dateKeys.length === 0 || !input.dateKeys.every(isNonEmptyString)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  return runAction(() =>
    bulkOpenRentalDays({ offeringId: input.offeringId as string, dates: input.dateKeys as string[], reopenBlocked: input.reopenBlocked === true }),
  );
}

export type BlockRentalDaysActionInput = { offeringId: unknown; dateKeys: unknown };

export async function blockRentalDaysAction(input: BlockRentalDaysActionInput): Promise<RentalActionResult> {
  if (!isNonEmptyString(input.offeringId)) return { ok: false, code: "INVALID_INPUT" };
  if (!Array.isArray(input.dateKeys) || input.dateKeys.length === 0 || !input.dateKeys.every(isNonEmptyString)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const offeringId = input.offeringId;
  // Blocking is per-date, idempotent, and independent (the domain has no batch block); apply each in
  // turn and stop at the first domain error (earlier idempotent blocks stand — the UI refreshes after).
  try {
    for (const dateKey of input.dateKeys as string[]) {
      const result = await blockRentalDay({ offeringId, date: dateKey });
      if (!result.ok) return { ok: false, code: result.error };
    }
    revalidateWorkspace();
    return { ok: true };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}

export type SetRentalDayOverrideActionInput = { offeringId: unknown; dateKey: unknown; amount: unknown };

export async function setRentalDayOverrideAction(input: SetRentalDayOverrideActionInput): Promise<RentalActionResult> {
  if (!isNonEmptyString(input.offeringId) || !isNonEmptyString(input.dateKey)) return { ok: false, code: "INVALID_INPUT" };
  // amount: a non-empty money string to set, or null to clear. Anything else is invalid input.
  let amount: string | null;
  if (input.amount === null) amount = null;
  else if (isNonEmptyString(input.amount)) amount = input.amount;
  else return { ok: false, code: "INVALID_MONEY" };
  return runAction(() => setDailyOverride({ offeringId: input.offeringId as string, date: input.dateKey as string, dailyAmountOverride: amount }));
}

/** null|undefined → the given passthrough; a positive-int (number or numeric string) → number; else INVALID. */
function normalizeCapacityOverride(raw: unknown): number | null | "INVALID" {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n <= 0) return "INVALID";
  return n;
}
