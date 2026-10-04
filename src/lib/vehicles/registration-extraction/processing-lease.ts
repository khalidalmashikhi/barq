// Phase 3C (registration OCR) — the one rule for "is this extraction being read RIGHT NOW?".
// Pure and isomorphic: shared by the extraction service, the review read model and the
// confirmation/finalize guards, so they can never disagree.
//
// A PROCESSING row is in progress only while its lease is live. Once the lease has expired the
// attempt is presumed dead (it crashed or timed out): the row no longer blocks anything — a retry
// may take it over and the provider may enter the details manually.

export type ExtractionProgressFacts = { status: string; processingExpiresAt: Date | null };

export function isExtractionInProgress(facts: ExtractionProgressFacts | null | undefined, now: Date = new Date()): boolean {
  if (!facts || facts.status !== "PROCESSING") return false;
  return facts.processingExpiresAt !== null && facts.processingExpiresAt.getTime() > now.getTime();
}

/** PROCESSING whose lease has run out — the attempt died; treat as a retryable failure. */
export function isExtractionAbandoned(facts: ExtractionProgressFacts | null | undefined, now: Date = new Date()): boolean {
  return !!facts && facts.status === "PROCESSING" && !isExtractionInProgress(facts, now);
}
