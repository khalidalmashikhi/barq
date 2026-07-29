// Contract Lifecycle Engine — Phase E.2. Public entry point; consumers
// should import from "@/lib/contracts/lifecycle" rather than reaching
// into individual files here, matching this codebase's existing
// Convention over Configuration pattern.

export { BOOKING_CONTRACT_STATUSES, TERMINAL_BOOKING_CONTRACT_STATUSES, isTerminalBookingContractStatus } from "./states";
export { canTransition, getAllowedNextStatuses } from "./transitions";
export {
  BookingContractNotFoundError,
  InvalidBookingContractTransitionError,
  ArchivedBookingContractError,
} from "./errors";
export {
  transitionContract,
  transitionContractAndFireHooks,
  type TransitionContractParams,
} from "./transition-contract";
export {
  dispatchContractHook,
  onGenerated,
  onIssued,
  onActivated,
  onCompleted,
  onCancelled,
  onExpired,
  type ContractHookContext,
  type ContractHookRegistry,
} from "./hooks";
