import "server-only";
import type { BookingActorType, ContractSignatureMethod } from "@prisma/client";

// Signature Provider Interface — Phase E.3, requirement #2. "No
// provider-specific logic outside the provider layer" — sign-contract.ts
// (the caller) only ever talks to this interface; it never branches on
// which vendor produced a signature. Mirrors this codebase's other
// factory/interface patterns exactly (OtpProvider from Phase D.4,
// ContractTemplate from Phase E.2).

export interface SignatureRequest {
  contractId: string;
  signerType: BookingActorType;
  signerId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SignatureResult {
  signedAt: Date;
  /// An external reference ID from the provider (e.g. a future
  /// DocuSign envelope ID) — undefined for providers with no such
  /// concept (e.g. INTERNAL).
  providerReference?: string;
}

export interface SignatureProvider {
  readonly key: string;
  readonly method: ContractSignatureMethod;
  sign(request: SignatureRequest): Promise<SignatureResult>;
}
