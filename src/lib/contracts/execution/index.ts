// Signature Execution Engine — Phase E.3. Public entry point for the
// state-machine primitives; consumers should import from
// "@/lib/contracts/execution" rather than reaching into individual
// files here. Operation-level functions (start/sign/view/download/
// verify) are exported from their own files at this same barrel level
// once added — see the sibling files in this directory.

export {
  CONTRACT_EXECUTION_STATUSES,
  TERMINAL_CONTRACT_EXECUTION_STATUSES,
  isTerminalContractExecutionStatus,
} from "./states";
export { canTransition, getAllowedNextStatuses } from "./transitions";
export {
  ContractExecutionNotFoundError,
  ContractExecutionAlreadyExistsError,
  InvalidContractExecutionTransitionError,
  NotPendingThisSignerError,
} from "./errors";
export {
  transitionExecution,
  transitionExecutionAndFireHooks,
  type TransitionExecutionParams,
} from "./transition-execution";
export {
  dispatchExecutionHook,
  onCustomerSigned,
  onPendingProvider,
  onProviderSigned,
  onExecuted,
  onCancelled,
  onExpired,
  type ExecutionHookContext,
  type ExecutionHookRegistry,
} from "./hooks";
export { ContractExecutionExpiredError, ContractNotYetGeneratedError } from "./errors";
export {
  getSignatureProvider,
  type SignatureProviderKey,
} from "./signature-providers/get-signature-provider";
export type { SignatureProvider, SignatureRequest, SignatureResult } from "./signature-providers/signature-provider";
export { internalSignatureProvider } from "./signature-providers/internal-signature-provider";
export { isSignatureIpLoggingEnabled, resolveSignatureIp } from "./ip-config";
export {
  generateVerificationToken,
  verifyContractToken,
  getVerificationUrl,
  type ContractVerificationResult,
} from "./verification";
export {
  notifyContractEvent,
  resolveContractParties,
  type ContractNotificationKind,
  type NotifyContractEventParams,
  type ContractParties,
} from "./notify";
export {
  startContractExecution,
  type StartContractExecutionParams,
  type StartContractExecutionResult,
} from "./start-execution";
export { signContract, type SigningActorType, type SignContractParams, type SignContractResult } from "./sign-contract";
export { recordContractViewed, type RecordContractViewedParams } from "./view-contract";
export { getContractPdfForDownload, type GetContractPdfForDownloadParams } from "./download-contract";
export type { SignedUrlProvider } from "./signed-url";
export {
  getContractExecutionStatus,
  type ContractExecutionStatusSummary,
  type ExecutionSignatureSummary,
} from "./get-execution-status";
