import "server-only";
import type { BookingActorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { BookingContractNotFoundError } from "../lifecycle";
import { recordContractDownloaded } from "../record-contract-downloaded";
import { generateContractPdf } from "../pdf/generate-contract-pdf";
import type { ContractContent } from "../templates/template";
import { ContractNotYetGeneratedError } from "./errors";

// Secure Download — Phase E.3, requirement #5. "Support authenticated
// downloads. Prevent unauthorized access." — authorization (owning
// customer/provider/admin) is enforced by the caller, exactly like
// Phase E.1's /api/bookings/[id]/history route: this library function
// only produces PDF bytes for an already-authorized request and
// records the download; it deliberately does not re-implement RBAC
// (a route-layer concern, not a library-layer one, matching this
// codebase's established division between the two).
//
// "Prepare temporary signed URLs if storage moves to object storage
// later" — nothing is persisted to any object storage today (PDFs are
// generated on demand, in memory, exactly as Phase E.2 built
// generateContractPdf() — never written to disk/S3/etc.), so there is
// no file to point a signed URL at yet. See
// src/lib/contracts/execution/signed-url.ts for the reserved,
// unimplemented interface this becomes relevant for once that changes.

export interface GetContractPdfForDownloadParams {
  contractId: string;
  actorType: BookingActorType;
  actorId?: string;
}

export async function getContractPdfForDownload(params: GetContractPdfForDownloadParams): Promise<{
  pdf: Buffer;
  contractNumber: string;
}> {
  const { contractId, actorType, actorId } = params;

  const contract = await prisma.bookingContract.findUnique({
    where: { id: contractId },
    select: { id: true, contractNumber: true, content: true },
  });

  if (!contract) {
    throw new BookingContractNotFoundError(contractId);
  }
  if (!contract.content) {
    throw new ContractNotYetGeneratedError(contractId);
  }

  const pdf = generateContractPdf(contract.content as unknown as ContractContent, {
    contractNumber: contract.contractNumber,
    generatedAt: new Date(),
  });

  await recordContractDownloaded({ contractId, actorType, actorId });
  logger.info("contract.downloaded", { contractId, actorType });

  return { pdf, contractNumber: contract.contractNumber };
}
