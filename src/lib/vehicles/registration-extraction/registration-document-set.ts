import { createHash } from "node:crypto";
import type { RegistrationReadableMimeType } from "./ocr/registration-document-reader";

// Phase 3C — the vehicle-registration DOCUMENT SET. Pure (no server-only, no database): the shape
// rules and the deterministic set hash that every other part relies on.
//
// One logical registration set is EXACTLY one of:
//   • one PDF (one or two pages);
//   • one image (front / primary side);
//   • two ORDERED images: front, then back.
// A PDF never shares a set with an image. The back side is optional; a front side is required.
//
// STORAGE MODEL (no schema change): the set is stored as up to two AssetDocument rows of the same
// asset — type VEHICLE_REGISTRATION (front / primary / the PDF) and VEHICLE_REGISTRATION_BACK (the
// optional back image). The existing @@unique([assetId, type]) keeps each side single; the order is
// the type order below, never a user-supplied index.
//
// SET HASH — the identity every downstream record binds to (extraction.documentSha256, the consent
// row, the confirmation's bound hash, OCR reuse):
//   • ONE page: the page's own SHA-256 — byte-identical to what single-document rows have always
//     stored, so every existing extraction / consent / confirmation stays valid;
//   • TWO pages: SHA-256 over "set-v1\n" + <front hash> + "\n" + <back hash> — ORDER-SENSITIVE, so
//     replacing, removing, adding or swapping either side yields a different hash, which makes the
//     previous extraction stale and the previous consent "not granted" (a decision about other
//     bytes). A partial set can never hash like a complete one.

export const REGISTRATION_FRONT_TYPE = "VEHICLE_REGISTRATION" as const;
export const REGISTRATION_BACK_TYPE = "VEHICLE_REGISTRATION_BACK" as const;
/** Ordered: the front/primary side first, the optional back side second. */
export const REGISTRATION_SET_TYPES = [REGISTRATION_FRONT_TYPE, REGISTRATION_BACK_TYPE] as const;
export type RegistrationSetType = (typeof REGISTRATION_SET_TYPES)[number];
export type RegistrationPageRole = "FRONT" | "BACK";

/** Hard ceiling on pages (sides) in one set. A PDF's own page limit is MAX_REGISTRATION_PDF_PAGES. */
export const MAX_REGISTRATION_SET_PAGES = 2;

export type RegistrationSetPage = {
  role: RegistrationPageRole;
  mimeType: string;
  sha256: string;
  byteLength: number;
};

export function roleOfRegistrationType(type: string): RegistrationPageRole | null {
  return type === REGISTRATION_FRONT_TYPE ? "FRONT" : type === REGISTRATION_BACK_TYPE ? "BACK" : null;
}

export function sha256Hex(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * The deterministic, order-sensitive identity of a set from its pages' hashes (front first).
 * One page → that page's hash (unchanged from the single-document era). Two pages → a hash over
 * the ordered pair. Empty → throws (there is no set).
 */
export function computeRegistrationSetHash(pageHashes: readonly string[]): string {
  if (pageHashes.length === 0) throw new Error("a registration set has at least one page");
  if (pageHashes.length === 1) return pageHashes[0]!;
  if (pageHashes.length > MAX_REGISTRATION_SET_PAGES) throw new Error("a registration set has at most two pages");
  return createHash("sha256").update("set-v1\n" + pageHashes.join("\n")).digest("hex");
}

export type RegistrationSetShapeProblem = "EMPTY_SET" | "TOO_MANY_PAGES" | "PDF_WITH_IMAGE" | "BACK_MUST_BE_IMAGE" | "FRONT_MISSING";

/**
 * The shape rules of a set, from its ordered pages (front first). Pure: no bytes are inspected
 * here — each page's type was already validated and normalized by the vehicle-document policy.
 */
export function checkRegistrationSetShape(pages: readonly { role: RegistrationPageRole; mimeType: string }[]): RegistrationSetShapeProblem | null {
  if (pages.length === 0) return "EMPTY_SET";
  if (pages.length > MAX_REGISTRATION_SET_PAGES) return "TOO_MANY_PAGES";
  if (pages[0]!.role !== "FRONT") return "FRONT_MISSING";
  const pdfCount = pages.filter((p) => p.mimeType === "application/pdf").length;
  if (pages.length === 2 && pages[1]!.role !== "BACK") return "FRONT_MISSING";
  if (pages.some((p) => p.role === "BACK" && p.mimeType === "application/pdf")) return "BACK_MUST_BE_IMAGE";
  if (pdfCount > 0 && pages.length > 1) return "PDF_WITH_IMAGE";
  return null;
}

/** What a reader is handed: the ordered pages with their bytes (a PDF is always a single page entry). */
export type RegistrationReadablePage = { role: RegistrationPageRole; bytes: ArrayBuffer; mimeType: RegistrationReadableMimeType };
