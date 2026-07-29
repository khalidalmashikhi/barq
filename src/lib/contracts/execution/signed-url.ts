import "server-only";

// Secure Download — Phase E.3, requirement #5's "Prepare temporary
// signed URLs if storage moves to object storage later." Reserved,
// unimplemented interface. Nothing calls this today — PDFs are
// generated on demand, in memory (download-contract.ts), never
// persisted to any object storage, so there is no stored file yet for
// a signed URL to point at. A future phase that wires up real object
// storage (`.env.example`'s `OBJECT_STORAGE_*` variables are already
// documented, unconsumed by any code path today) implements this and
// swaps it in without changing getContractPdfForDownload()'s callers.

export interface SignedUrlProvider {
  createSignedDownloadUrl(contractId: string, expiresInSeconds: number): Promise<string>;
}
