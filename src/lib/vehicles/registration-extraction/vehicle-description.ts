// Phase 3C (Oman parsing discrepancy correction, 2026-10-09) — PURE, deterministic decomposition
// of the COMPOUND vehicle description an Omani registration prints under "نوع المركبة" (usually
// manufacturer + body style + commercial model, in either order, e.g. a brand, "صالون", then "6").
//
// ONE shared stage for BOTH tiers (native PDF text and OCR candidates). It works on the FOLDED form
// of the text (normalize.ts: canonical letters instead of presentation-form glyphs, no diacritics /
// tatweel / bidi marks, punctuation → spaces, Western digits, lower case), so "ﻣﺎﺯﺩﺍ ﺻﺎﻟﻮﻥ ٦",
// "مــازدا صـالون 6", "مَازْدَا صَالُون 6" and "صالون مازدا 6" all decompose alike — while the
// document's own spelling is kept for the model name and the whole description is preserved
// separately for the provider to compare against.
//
// The rules are deliberately CONSERVATIVE:
//   • a manufacturer is recognized ONLY from the governed registry (manufacturer-registry.ts),
//     at a token boundary, anywhere in the description; the CANONICAL name is emitted;
//   • exactly ONE manufacturer must be recognized — none → unknown (nothing split), two different
//     ones → ambiguous (nothing split);
//   • body-style words come ONLY from the governed registry (body-style-registry.ts); they are
//     removed from the model name and reported as a type HINT (the provider still chooses);
//   • a 4-digit year is never part of a model name (it belongs to the year field);
//   • what remains is the commercial model only when it is bounded (1–4 tokens, ≤ 40 chars):
//     a numeric model such as "6", "300" or "500" is fine; an unbounded remainder gives NO model;
//   • when nothing remains there is no model — nothing is invented.
// Every value derived here is a LOW-confidence suggestion the builder flags "HEURISTIC_SPLIT".

import { cleanValue, foldForMatching } from "./normalize";
import { matchManufacturerAt } from "./manufacturer-registry";
import { matchBodyStyleAt, suggestTypeFromBodyStyles, type BodyStyleKey } from "./body-style-registry";
import type { VehicleTypeCode } from "@/lib/vehicles/vehicle-type-codes";

export type VehicleDescriptionSplit = {
  /** The CANONICAL manufacturer name from the registry. */
  make: string;
  /** The commercial model name in the document's own spelling, body-style words removed; null when nothing bounded remains. */
  model: string | null;
  /** Why there is no model, when `model` is null. */
  modelReason: "NONE_LEFT" | "UNBOUNDED" | null;
  /** Body styles recognized (registry keys), in document order. */
  bodyStyles: BodyStyleKey[];
  /** The most specific vehicle-type SUGGESTION the body styles map to, or null — never applied by itself. */
  vehicleType: VehicleTypeCode | null;
};

export type VehicleDescriptionOutcome =
  | { ok: true; split: VehicleDescriptionSplit }
  | { ok: false; reason: "EMPTY" | "UNKNOWN_MANUFACTURER" | "AMBIGUOUS_MANUFACTURER" };

const MAX_MODEL_TOKENS = 4;
const MAX_MODEL_CHARS = 40;

/** True when a value is nothing but a 4-digit year (Western or Arabic-Indic digits) — such a value
 *  is never a make or model name. */
export function isYearLike(value: string): boolean {
  return /^(19|20)\d{2}$/.test(foldForMatching(value));
}

type FoldedToken = { folded: string; origIndex: number };

/** Tokenize the ORIGINAL (cleaned) text and fold each token; a token that folds into several
 *  words ("pick-up" → "pick", "up") yields several folded tokens pointing at the same original. */
function tokenize(description: string): { original: string[]; folded: FoldedToken[] } {
  const original = cleanValue(description).split(" ").filter(Boolean);
  const folded: FoldedToken[] = [];
  original.forEach((tok, origIndex) => {
    for (const part of foldForMatching(tok).split(" ").filter(Boolean)) folded.push({ folded: part, origIndex });
  });
  return { original, folded };
}

export function splitVehicleDescription(description: string): VehicleDescriptionOutcome {
  const { original, folded } = tokenize(description);
  if (folded.length === 0) return { ok: false, reason: "EMPTY" };
  const words = folded.map((t) => t.folded);

  const makes: string[] = [];
  const bodyStyles: BodyStyleKey[] = [];
  const consumed = new Set<number>(); // indexes into `folded`
  let i = 0;
  while (i < words.length) {
    const m = matchManufacturerAt(words, i);
    if (m) {
      makes.push(m.canonical);
      for (let k = 0; k < m.tokenCount; k++) consumed.add(i + k);
      i += m.tokenCount;
      continue;
    }
    const b = matchBodyStyleAt(words, i);
    if (b) {
      bodyStyles.push(b.key);
      for (let k = 0; k < b.tokenCount; k++) consumed.add(i + k);
      i += b.tokenCount;
      continue;
    }
    i++;
  }

  const distinctMakes = Array.from(new Set(makes));
  if (distinctMakes.length === 0) return { ok: false, reason: "UNKNOWN_MANUFACTURER" };
  if (distinctMakes.length > 1) return { ok: false, reason: "AMBIGUOUS_MANUFACTURER" };
  const make = distinctMakes[0]!;

  // The model is what is left, in the document's own spelling: an original token is kept only when
  // NONE of its folded parts was consumed and it is not a bare 4-digit year.
  const leftover = new Set<number>();
  folded.forEach((t, idx) => {
    if (!consumed.has(idx)) leftover.add(t.origIndex);
  });
  folded.forEach((t, idx) => {
    if (consumed.has(idx)) leftover.delete(t.origIndex);
  });
  const modelTokens = original.filter((tok, idx) => leftover.has(idx) && !isYearLike(tok) && foldForMatching(tok).length > 0);

  let model: string | null = null;
  let modelReason: VehicleDescriptionSplit["modelReason"] = null;
  if (modelTokens.length === 0) modelReason = "NONE_LEFT";
  else if (modelTokens.length > MAX_MODEL_TOKENS || modelTokens.join(" ").length > MAX_MODEL_CHARS) modelReason = "UNBOUNDED";
  else model = modelTokens.join(" ");

  return { ok: true, split: { make, model, modelReason, bodyStyles, vehicleType: suggestTypeFromBodyStyles(bodyStyles) } };
}

/** Body-style-based vehicle-type suggestion for any free text (description / make / model /
 *  usage). Governed registry only; null when nothing recognizable — never OTHER, never a default. */
export function suggestVehicleTypeFromText(text: string): VehicleTypeCode | null {
  const words = foldForMatching(text).split(" ").filter(Boolean);
  const keys: BodyStyleKey[] = [];
  let i = 0;
  while (i < words.length) {
    const b = matchBodyStyleAt(words, i);
    if (b) {
      keys.push(b.key);
      i += b.tokenCount;
    } else i++;
  }
  return suggestTypeFromBodyStyles(keys);
}
