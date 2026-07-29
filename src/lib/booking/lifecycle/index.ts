// Booking Lifecycle Engine — Phase E.1. Public entry point; consumers
// should import from "@/lib/booking/lifecycle" rather than reaching
// into individual files here, matching this codebase's existing
// Convention over Configuration pattern (see src/lib/auth/index.ts).

export { BOOKING_STATUSES, TERMINAL_BOOKING_STATUSES, isTerminalBookingStatus } from "./states";
export { canTransition, getAllowedNextStatuses } from "./transitions";
export { BookingNotFoundError, InvalidBookingTransitionError } from "./errors";
export {
  transitionBooking,
  transitionBookingAndFireHooks,
  type TransitionBookingParams,
} from "./transition-booking";
export { recordBookingCreated, type RecordBookingCreatedParams } from "./record-booking-created";
export { getBookingTimeline, type BookingTimelineEntry } from "./get-booking-timeline";
export {
  dispatchLifecycleHook,
  onPendingProvider,
  onAccepted,
  onRejected,
  onInProgress,
  onCompleted,
  onCancelled,
  onDisputed,
  type BookingHookContext,
} from "./hooks";
export {
  notifyBookingEvent,
  resolveBookingParties,
  type BookingNotificationKind,
  type BookingParties,
} from "./notify";
