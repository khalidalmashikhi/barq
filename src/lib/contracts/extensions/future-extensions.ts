import "server-only";
import type { BookingActorType } from "@prisma/client";

// Extension Points — Phase E.2, requirement #10. Pure interfaces only
// — deliberately no implementation, no runtime code, nothing that
// touches the database or an external vendor. A future phase
// implements one of these and wires it into the contract lifecycle
// hooks (src/lib/contracts/lifecycle/hooks.ts's onIssued/onActivated
// are the natural attachment points) without this file changing.

export interface SignerInfo {
  actorType: BookingActorType;
  actorId?: string;
}

export interface SignatureRequestResult {
  requestId: string;
}

export interface SignatureVerificationResult {
  signed: boolean;
  signedAt?: Date;
}

/// Future electronic signature integration (requirement #10). A real
/// implementation would call an e-signature vendor's API — mirroring
/// this codebase's OtpProvider/ContractTemplate factory pattern, a
/// future getSignatureProvider() factory would select between vendors
/// by a config key, exactly like get-otp-provider.ts (Phase D.4).
export interface ElectronicSignatureProvider {
  requestSignature(contractId: string, signer: SignerInfo): Promise<SignatureRequestResult>;
  verifySignature(contractId: string): Promise<SignatureVerificationResult>;
}

export interface QrVerificationResult {
  valid: boolean;
  contractId?: string;
}

/// Future QR verification (requirement #10) — e.g. a printed contract
/// PDF includes a QR code that resolves to a public verification page
/// confirming the contract's authenticity/status.
export interface QrVerificationService {
  generateVerificationCode(contractId: string): Promise<string>;
  verifyCode(code: string): Promise<QrVerificationResult>;
}

export type ApprovalType = "GOVERNMENT" | "EMPLOYER" | "CUSTOMER";

export interface ApprovalRequestResult {
  requestId: string;
}

/// Future approval workflow (requirement #10) — government, employer,
/// and customer approval are three distinct approver types sharing one
/// interface shape, since a future implementation is expected to model
/// each as a workflow step rather than three unrelated features.
export interface ApprovalWorkflow {
  requestApproval(contractId: string, approverType: ApprovalType): Promise<ApprovalRequestResult>;
  recordApprovalDecision(contractId: string, decision: "APPROVED" | "REJECTED", note?: string): Promise<void>;
}
