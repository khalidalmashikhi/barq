import { describe, it, expect } from "vitest";
import { deriveReviewState, isConfirmationStale, extractionFailureLabelKey } from "./review-status";

const extraction = (over: Partial<{ status: "EXTRACTED" | "NEEDS_REVIEW" | "FAILED"; failureCode: string | null; documentSha256: string; parserVersion: string }> = {}) => ({
  status: "EXTRACTED" as const, failureCode: null, documentSha256: "sha-1", parserVersion: "1.0.0", ...over,
});
const confirmation = (over: Partial<{ status: "DRAFT" | "SUBMITTED" | "SUPERSEDED"; boundDocumentSha256: string; boundParserVersion: string }> = {}) => ({
  status: "DRAFT" as const, boundDocumentSha256: "sha-1", boundParserVersion: "1.0.0", ...over,
});

describe("deriveReviewState", () => {
  it("no extraction → NOT_ANALYZED, can analyze, cannot confirm", () => {
    const s = deriveReviewState(null, null);
    expect(s).toMatchObject({ extraction: "NOT_ANALYZED", confirmation: "NONE", canAnalyze: true, canConfirm: false });
  });
  it("FAILED extraction → safe failure label, retryable AND manual-entry confirmable", () => {
    const s = deriveReviewState(extraction({ status: "FAILED", failureCode: "PDF_ENCRYPTED" }), null);
    expect(s.extraction).toBe("FAILED");
    expect(s.failureLabelKey).toBe("vehicleRegExtractFailEncrypted");
    expect(s.canAnalyze).toBe(true); // Retry still available
    expect(s.canConfirm).toBe(true); // manual entry allowed for scanned/unreadable documents
  });

  it("NOT_ANALYZED is never confirmable (no extraction row to attach a claim to)", () => {
    expect(deriveReviewState(null, null).canConfirm).toBe(false);
  });
  it("EXTRACTED + no confirmation → confirmable", () => {
    const s = deriveReviewState(extraction(), null);
    expect(s).toMatchObject({ extraction: "EXTRACTED", confirmation: "NONE", canConfirm: true, locked: false });
  });
  it("SUBMITTED current claim → locked, not confirmable", () => {
    const s = deriveReviewState(extraction(), confirmation({ status: "SUBMITTED" }));
    expect(s).toMatchObject({ confirmation: "SUBMITTED", locked: true, canConfirm: false });
  });
  it("replaced document (hash changed) → active claim is STALE and confirmable again", () => {
    const s = deriveReviewState(extraction({ documentSha256: "sha-2" }), confirmation({ status: "SUBMITTED", boundDocumentSha256: "sha-1" }));
    expect(s.confirmation).toBe("STALE");
    expect(s.locked).toBe(false);
    expect(s.canConfirm).toBe(true);
  });
  it("SUPERSEDED claim is reported as history", () => {
    expect(deriveReviewState(extraction(), confirmation({ status: "SUPERSEDED" })).confirmation).toBe("SUPERSEDED");
  });
});

describe("isConfirmationStale / failure labels", () => {
  it("stale on hash OR parser-version change", () => {
    expect(isConfirmationStale(confirmation({ boundDocumentSha256: "old" }), extraction())).toBe(true);
    expect(isConfirmationStale(confirmation({ boundParserVersion: "0.9.0" }), extraction())).toBe(true);
    expect(isConfirmationStale(confirmation(), extraction())).toBe(false);
  });
  it("unknown failure code maps to the generic safe label", () => {
    expect(extractionFailureLabelKey("SOMETHING_WEIRD")).toBe("vehicleRegExtractFailGeneric");
    expect(extractionFailureLabelKey(null)).toBe("vehicleRegExtractFailGeneric");
  });
});

describe("PROCESSING — the document is being read (OCR in flight)", () => {
  const NOW = new Date("2026-10-05T10:00:00Z");
  const reading = (expiresInMs: number) => ({ status: "PROCESSING" as const, failureCode: null, documentSha256: "sha-1", parserVersion: "1.0.0", processingExpiresAt: new Date(NOW.getTime() + expiresInMs) });

  it("a LIVE lease → PROCESSING: wait — no analyze (no second reading), no confirm (suggestions are about to arrive)", () => {
    const s = deriveReviewState(reading(30_000), null, NOW);
    expect(s).toMatchObject({ extraction: "PROCESSING", failureLabelKey: null, canAnalyze: false, canConfirm: false, locked: false });
  });

  it("an EXPIRED lease (the attempt died) → shown as a retryable failure with manual entry open — never an endless spinner", () => {
    const s = deriveReviewState(reading(-1), null, NOW);
    expect(s).toMatchObject({ extraction: "FAILED", failureLabelKey: "vehicleRegExtractFailOcrTimeout", canAnalyze: true, canConfirm: true });
  });

  it("PROCESSING without a lease timestamp is treated as abandoned (fail open for the provider, never stuck)", () => {
    const s = deriveReviewState({ status: "PROCESSING", failureCode: null, documentSha256: "sha-1", parserVersion: "1.0.0", processingExpiresAt: null }, null, NOW);
    expect(s).toMatchObject({ extraction: "FAILED", canAnalyze: true, canConfirm: true });
  });

  it.each([
    ["OCR_NOT_CONFIGURED", "vehicleRegExtractFailOcrUnavailable"],
    ["OCR_PROVIDER_ERROR", "vehicleRegExtractFailOcrUnavailable"],
    ["OCR_TIMEOUT", "vehicleRegExtractFailOcrTimeout"],
    ["OCR_UNREADABLE", "vehicleRegExtractFailOcrUnreadable"],
    ["OCR_MALFORMED_RESPONSE", "vehicleRegExtractFailGeneric"],
  ])("OCR failure %s → a safe localized label (%s), retry + manual entry both available", (code, label) => {
    const s = deriveReviewState({ status: "FAILED", failureCode: code, documentSha256: "sha-1", parserVersion: "1.0.0" }, null, NOW);
    expect(s).toMatchObject({ extraction: "FAILED", failureLabelKey: label, canAnalyze: true, canConfirm: true });
  });
});
