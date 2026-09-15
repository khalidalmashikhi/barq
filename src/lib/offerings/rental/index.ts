// Phase 3C Slice C2b-R — public surface of the rental-offering provider write authority. Server-only
// domain functions (NO API routes, NO UI in this slice). Provider identity is always session-derived.

export type { RentalOfferingErrorCode, RentalOfferingResult } from "./rental-offering-errors";
export type { RentalOfferingDTO, RentalBulkOpenSummary, RentalStartTimesSummary } from "./rental-offering-dto";

// The nine bounded mutations.
export { createRentalOffering, type CreateRentalOfferingInput } from "./create-rental-offering";
export { updateRentalOffering, type UpdateRentalOfferingInput } from "./update-rental-offering";
export { publishRentalOffering, suspendRentalOffering, archiveRentalOffering } from "./transition-rental-offering";
export { bulkOpenRentalDays, type BulkOpenRentalDaysInput } from "./bulk-open-days";
export { blockRentalDay, type BlockRentalDayInput, type BlockRentalDayResult } from "./block-day";
export { setDailyOverride, type SetDailyOverrideInput, type DailyOverrideResult } from "./set-daily-override";
export { manageStartTimes, type ManageStartTimesInput, MAX_START_TIMES_PER_DAY } from "./manage-start-times";
