// Phase 3C (incomplete native-PDF correction, 2026-10-09) — the one rule for "is an optional
// automatic COMPLETION of this reading running right now?". Pure and isomorphic: shared by the
// extraction service (lease claim) and the review read model (progress banner), so they can never
// disagree.
//
// A completion holds the row's lease columns (processingToken / processingExpiresAt) WITHOUT
// changing its status: the local reading stays EXTRACTED / NEEDS_REVIEW and usable. A PROCESSING
// row is the regular reading's lease (processing-lease.ts), never a completion.

/** `processingToken` may be omitted by a reader that must not select it (the review read model):
 *  the completion lease always sets and clears the token and the expiry TOGETHER, so a live expiry
 *  on a non-PROCESSING row is the lease. */
export type CompletionLeaseFacts = { status: string; processingToken?: string | null; processingExpiresAt?: Date | null };

export function isCompletionInProgress(row: CompletionLeaseFacts | null | undefined, now: Date = new Date()): boolean {
  if (!row || row.status === "PROCESSING") return false;
  if (row.processingToken === null) return false;
  return row.processingExpiresAt instanceof Date && row.processingExpiresAt.getTime() > now.getTime();
}
