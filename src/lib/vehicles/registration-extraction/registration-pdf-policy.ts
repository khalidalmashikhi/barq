import "server-only";
import { extractPdfText } from "./pdf-text";
import { MAX_REGISTRATION_PDF_PAGES } from "./constants";

// VEHICLE-REGISTRATION-ONLY structural rule for an uploaded registration PDF. It applies to exactly
// one document type — VEHICLE_REGISTRATION — because that document is later opened by this same
// bounded parser (native-text extraction) and reviewed field by field. It is NOT a general PDF
// rule: other vehicle documents (e.g. insurance) and every provider-verification document are
// never passed through it and keep their own limits.
//
// Opening the file now means an encrypted, corrupt, polyglot or over-long registration PDF is
// refused at upload rather than discovered after it was stored. A scan with no text layer opens
// fine and is accepted (it goes to manual review).

export type RegistrationPdfProblem = "PDF_ENCRYPTED" | "PDF_CORRUPT" | "PDF_TOO_MANY_PAGES";

export async function checkRegistrationPdfStructure(bytes: ArrayBuffer): Promise<RegistrationPdfProblem | null> {
  // The PDF engine TRANSFERS (detaches) the buffer it is given, leaving it zero-length. The check
  // therefore runs on a COPY — the caller's bytes are what gets stored.
  const result = await extractPdfText(bytes.slice(0), { maxPages: MAX_REGISTRATION_PDF_PAGES });
  if (result.ok) return null;
  switch (result.code) {
    case "PDF_ENCRYPTED":
      return "PDF_ENCRYPTED";
    case "PDF_MALFORMED":
    case "PDF_TRAILING_DATA":
    case "EXTRACTION_FAILED": // the bounded parser could not open it at all → fail closed
      return "PDF_CORRUPT";
    case "PDF_PAGE_LIMIT":
      return "PDF_TOO_MANY_PAGES";
    default:
      // NO_TEXT_LAYER (a scan), TEXT_LIMIT_EXCEEDED, PARSER_TIMEOUT — the file opened as a PDF; it
      // simply cannot be read automatically → stored and sent to manual review.
      return null;
  }
}
