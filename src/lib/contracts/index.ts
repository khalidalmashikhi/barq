// Contract Engine — Phase E.2 (Electronic Contract Foundation). Public
// entry point; consumers should import from "@/lib/contracts" rather
// than reaching into individual files here, matching this codebase's
// existing Convention over Configuration pattern.

export * from "./lifecycle";
export { generateContractNumber, type GenerateContractNumberOptions } from "./contract-number";
export type { BilingualText, ContractContentSection, ContractContent, ContractRenderContext, ContractTemplate } from "./templates/template";
export { getContractTemplate, type ContractTemplateKey } from "./templates/get-contract-template";
export { standardServiceTemplate, premiumServiceTemplate, corporateTemplate } from "./templates/service-templates";
export type { ContractPdfMeta, ContractPdfGenerator } from "./pdf/pdf-generator";
export { buildSimplePdf } from "./pdf/simple-pdf-writer";
export { simpleContractPdfGenerator, generateContractPdf } from "./pdf/generate-contract-pdf";
export {
  createContractFromBooking,
  type CreateContractFromBookingParams,
  type CreateContractFromBookingResult,
} from "./create-contract";
export { generateContractContent, type GenerateContractContentParams } from "./generate-contract";
export { recordContractDownloaded, type RecordContractDownloadedParams } from "./record-contract-downloaded";
export {
  createContractRevision,
  type CreateContractRevisionParams,
  type CreateContractRevisionResult,
} from "./create-contract-version";
export { getContractHistory, type ContractHistoryEntry } from "./get-contract-history";
export type {
  SignerInfo,
  SignatureRequestResult,
  SignatureVerificationResult,
  ElectronicSignatureProvider,
  QrVerificationResult,
  QrVerificationService,
  ApprovalType,
  ApprovalRequestResult,
  ApprovalWorkflow,
} from "./extensions/future-extensions";

// Signature Execution Engine — Phase E.3. Extends this Contract Engine
// barrel with the execution module's own exports. Explicit
// (non-wildcard) re-export: the execution module has its OWN
// canTransition/getAllowedNextStatuses/onCancelled/onExpired for
// ContractExecutionStatus, which would otherwise collide with the
// Contract Engine's identically-named exports for BookingContractStatus
// above — aliased with an Execution prefix here so both remain
// reachable from this one barrel without ambiguity. Callers who need
// only one can still import directly from
// "@/lib/contracts/lifecycle" or "@/lib/contracts/execution".
//
// See docs/09-contracts/CONTRACT_EXECUTION.md for why this phase's own
// SignatureProvider/SignatureRequest/SignatureResult (a working,
// synchronous sign-now abstraction) is a deliberately separate,
// differently-named thing from the ElectronicSignatureProvider
// interface exported above (Phase E.2's own unimplemented,
// asynchronous request/verify placeholder).
export {
  CONTRACT_EXECUTION_STATUSES,
  TERMINAL_CONTRACT_EXECUTION_STATUSES,
  isTerminalContractExecutionStatus,
  canTransition as canTransitionExecution,
  getAllowedNextStatuses as getAllowedNextExecutionStatuses,
  ContractExecutionNotFoundError,
  ContractExecutionAlreadyExistsError,
  InvalidContractExecutionTransitionError,
  NotPendingThisSignerError,
  ContractExecutionExpiredError,
  ContractNotYetGeneratedError,
  transitionExecution,
  transitionExecutionAndFireHooks,
  type TransitionExecutionParams,
  dispatchExecutionHook,
  onCustomerSigned,
  onPendingProvider,
  onProviderSigned,
  onExecuted,
  onCancelled as onExecutionCancelled,
  onExpired as onExecutionExpired,
  type ExecutionHookContext,
  type ExecutionHookRegistry,
  getSignatureProvider,
  type SignatureProviderKey,
  type SignatureProvider,
  type SignatureRequest,
  type SignatureResult,
  internalSignatureProvider,
  isSignatureIpLoggingEnabled,
  resolveSignatureIp,
  generateVerificationToken,
  verifyContractToken,
  getVerificationUrl,
  type ContractVerificationResult,
  notifyContractEvent,
  resolveContractParties,
  type ContractNotificationKind,
  type NotifyContractEventParams,
  type ContractParties,
  startContractExecution,
  type StartContractExecutionParams,
  type StartContractExecutionResult,
  signContract,
  type SigningActorType,
  type SignContractParams,
  type SignContractResult,
  recordContractViewed,
  type RecordContractViewedParams,
  getContractPdfForDownload,
  type GetContractPdfForDownloadParams,
  type SignedUrlProvider,
  getContractExecutionStatus,
  type ContractExecutionStatusSummary,
  type ExecutionSignatureSummary,
} from "./execution";
