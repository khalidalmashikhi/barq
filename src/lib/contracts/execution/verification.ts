import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

// Contract Verification — Phase E.3, requirement #6. "No external
// verification service yet" — this is a 100% internal database
// lookup by an opaque token; no third-party call, no external
// verification vendor.
//
// The token is intentionally the OPPOSITE of a contract number
// (Phase E.2's contract-number.ts): a contract number is sequential
// and human-readable BY DESIGN (a reference humans read aloud); a
// verification token must be unguessable, since anyone who has it can
// look up a contract's execution status through the public
// verification endpoint (src/app/api/contracts/verify/[token]/route.ts)
// — hence crypto-random bytes, not a sequence.

export function generateVerificationToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface ContractVerificationResult {
  valid: boolean;
  contractNumber?: string;
  status?: string;
  executedAt?: Date;
}

// Deliberately minimal, non-sensitive fields only — this backs a
// PUBLIC, unauthenticated endpoint. Never returns `content`/terms,
// signer identities, or any other business-sensitive data — only
// enough to answer "is this a real, executed BARQ contract."
export async function verifyContractToken(token: string): Promise<ContractVerificationResult> {
  const execution = await prisma.contractExecution.findUnique({
    where: { verificationToken: token },
    select: {
      status: true,
      updatedAt: true,
      contract: { select: { contractNumber: true } },
    },
  });

  if (!execution) {
    return { valid: false };
  }

  return {
    valid: true,
    contractNumber: execution.contract.contractNumber,
    status: execution.status,
    executedAt: execution.status === "EXECUTED" ? execution.updatedAt : undefined,
  };
}

// QR placeholder (requirement #6) — returns the URL a QR code would
// encode; does NOT generate an actual QR image (that needs a QR
// -encoding library, a real dependency decision out of this
// foundation phase's scope — "QR placeholder" is taken literally).
export function getVerificationUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/contracts/verify/${token}`;
}
