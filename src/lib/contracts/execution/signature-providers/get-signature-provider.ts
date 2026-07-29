import "server-only";
import type { SignatureProvider } from "./signature-provider";
import { internalSignatureProvider } from "./internal-signature-provider";

// Signature Provider Factory — Phase E.3, requirement #2. The ONLY
// place that selects a signature provider by key — mirrors
// get-otp-provider.ts (Phase D.4) and get-contract-template.ts (Phase
// E.2) exactly. Adding a real vendor later is: implement
// SignatureProvider, add one `case` here — no other file changes.
//
// GOVERNMENT_PKI, ADOBE_SIGN, DOCUSIGN, and OMAN_TRUST_SERVICES are
// requirement #2's explicitly named future providers — recognized
// keys that throw a clear, distinct error today (reserved, not
// implemented) rather than silently falling back to the wrong
// provider, mirroring get-contract-template.ts's GOVERNMENT handling.

export type SignatureProviderKey = "INTERNAL" | "GOVERNMENT_PKI" | "ADOBE_SIGN" | "DOCUSIGN" | "OMAN_TRUST_SERVICES";

const RESERVED_FUTURE_PROVIDERS: readonly SignatureProviderKey[] = [
  "GOVERNMENT_PKI",
  "ADOBE_SIGN",
  "DOCUSIGN",
  "OMAN_TRUST_SERVICES",
];

export function getSignatureProvider(key: SignatureProviderKey): SignatureProvider {
  if (key === "INTERNAL") {
    return internalSignatureProvider;
  }

  if (RESERVED_FUTURE_PROVIDERS.includes(key)) {
    throw new Error(`getSignatureProvider: "${key}" is a reserved future signature provider — not implemented yet.`);
  }

  throw new Error(`getSignatureProvider: unknown signature provider key "${key}"`);
}
