import type { RegistrationCandidates } from "../types";

// Phase 3C (registration OCR) — the PROVIDER-NEUTRAL contract for reading a registration document
// SET that has no usable native text: one photo, two ordered photos (front and back), or a
// scanned / image-only / unreadable-text PDF of one or two pages.
//
// A reader does ONE thing: it looks at the pages and reports the TEXT it detected for each
// allowlisted registration field — merged across pages, with every distinct value kept so that a
// field printed differently on two sides is reported as two candidates (the deterministic rules
// then mark it as a CONFLICT the provider must resolve). It decides nothing. Normalization,
// validation, conflict detection, confidence and the "needs review" status are applied afterwards
// by the same deterministic rules used for native PDF text (parse-registration.ts), so an OCR
// engine can never introduce a value the rest of the system would not accept from a person typing.
//
// ONE SET = ONE CALL: a reader receives the complete ordered set and makes exactly one request for
// it — never one request per page.
//
// By construction the result has no place for an owner name, civil number, address or insurance
// detail: `RegistrationCandidates` only has keys for the allowlisted operational fields.
//
// Isomorphic types only — the concrete readers and the factory are server-only.

/** What a reader can be given: the stored (already validated / normalized) document bytes. */
export type RegistrationReadableMimeType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export const REGISTRATION_READABLE_MIME_TYPES: readonly RegistrationReadableMimeType[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function isRegistrationReadableMimeType(value: unknown): value is RegistrationReadableMimeType {
  return typeof value === "string" && (REGISTRATION_READABLE_MIME_TYPES as readonly string[]).includes(value);
}

/** One ordered page of the set handed to a reader. A PDF is always a single page entry (it may
 *  contain two printed pages); images are one entry per side, front first. */
export type RegistrationReadPage = { role: "FRONT" | "BACK"; bytes: ArrayBuffer; mimeType: RegistrationReadableMimeType };

export type RegistrationReadInput = { pages: readonly RegistrationReadPage[] };

/** Safe, fixed failure reasons — never a provider message, never document content.
 *  OCR_GEO_MISMATCH: the engine reported an inference geography other than the configured one —
 *  the answer is DISCARDED unread (fail closed, never a fallback to global routing).
 *  OCR_INPUT_TOO_LARGE: the set exceeds what a reader may send in one request (nothing was sent).
 *  OCR_INVALID_SET: the set's shape is not one a reader accepts (nothing was sent). */
export type RegistrationReadFailureCode = "OCR_TIMEOUT" | "OCR_PROVIDER_ERROR" | "OCR_MALFORMED_RESPONSE" | "OCR_GEO_MISMATCH" | "OCR_INPUT_TOO_LARGE" | "OCR_INVALID_SET";

export type RegistrationReadResult =
  | {
      ok: true;
      candidates: RegistrationCandidates;
      /** The inference geography the engine REPORTED for this answer (operational record), when
       *  the engine reports one. Always equal to the configured geography — a mismatch never
       *  yields an ok result. */
      inferenceGeo?: string | null;
    }
  | { ok: false; code: RegistrationReadFailureCode };

export interface RegistrationDocumentReader {
  /**
   * Stable identifier of the engine + version that produced a result, e.g.
   * "claude-vision/<model>/p3". Stored as operational metadata and used to reuse a result for
   * identical sets; it never contains a secret.
   */
  readonly engine: string;
  /** The inference geography this reader is pinned to ("us" | "global"), when the engine has one. */
  readonly inferenceGeo?: string;
  /** Never throws: every failure is one of the fixed codes. Never logs the document or its text.
   *  Makes at most ONE external request per call, for the whole set. */
  read(input: RegistrationReadInput): Promise<RegistrationReadResult>;
}
