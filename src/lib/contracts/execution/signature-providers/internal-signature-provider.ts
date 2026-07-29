import "server-only";
import type { SignatureProvider, SignatureRequest, SignatureResult } from "./signature-provider";

// Signature Provider — Phase E.3. This phase's ONLY real, working
// signature path: a simple in-app assertion of consent (the caller
// already authenticated the signer via the existing session/RBAC
// layer, and the signing action itself — e.g. clicking "I agree and
// sign" — is what this provider records). No external vendor call, no
// cryptographic signature, no per-document hash — genuinely "NOT the
// final electronic signature implementation" (Phase E.2's own framing,
// carried forward). A future real e-signature vendor is a new
// SignatureProvider implementation selected by get-signature-provider.ts,
// never a change to sign-contract.ts or this interface.

export const internalSignatureProvider: SignatureProvider = {
  key: "INTERNAL",
  method: "INTERNAL",

  async sign(request: SignatureRequest): Promise<SignatureResult> {
    void request;
    return { signedAt: new Date() };
  },
};
