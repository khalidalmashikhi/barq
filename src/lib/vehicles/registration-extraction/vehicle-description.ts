// Phase 3C (Oman parsing discrepancy correction, 2026-10-09) — PURE, deterministic decomposition
// of the COMPOUND vehicle description an Omani registration prints under "نوع المركبة" (usually
// manufacturer + body style + commercial model, in either order, e.g. a brand, "صالون", then "6").
//
// ONE shared stage for BOTH tiers (native PDF text and OCR candidates). It works on the FOLDED form
// of the text (normalize.ts: canonical letters instead of presentation-form glyphs, no diacritics /
// tatweel / bidi marks, unified alef / yeh / kaf / teh-marbuta variants, punctuation → spaces,
// Western digits, lower case), so "ﻣﺎﺯﺩﺍ ﺻﺎﻟﻮﻥ ٦", "مــازدا صـالون 6", "مَازْدَا صَالُون 6" and
// "صالون مازدا 6" all decompose alike — while the document's own spelling is kept for the model
// name and the whole description is preserved separately for the provider to compare against.
//
// The rules are deliberately CONSERVATIVE:
//   • a manufacturer is recognized ONLY from the governed registry (manufacturer-registry.ts),
//     at a token boundary, anywhere in the description; the CANONICAL name is emitted. Three
//     bounded recoveries, all requiring an EXACT registry alias (2026-10-09 staging finding):
//       – a manufacturer GLUED to its model ("مازدا6", "MAZDA6", "مازدا-6") is split at the
//         letter→digit boundary or the hyphen, only when the letter part IS an alias;
//       – a manufacturer broken into 2–3 FRAGMENTS by a PDF text-run gap ("ماز دا") is rejoined,
//         only when the concatenation IS an alias and no fragment is itself a known word;
//       – Persian/Arabic letter variants fold alike (normalize.ts).
//   • exactly ONE manufacturer must be recognized — none → unknown (nothing split), two different
//     ones → ambiguous (nothing split);
//   • body-style words come ONLY from the governed registry (body-style-registry.ts); they are
//     removed from the model name and reported as a type HINT (the provider still chooses);
//   • a 4-digit year is never part of a model name (it belongs to the year field);
//   • what remains is the commercial model only when it is bounded (1–4 tokens, ≤ 40 chars):
//     a numeric model such as "6", "300" or "500" is fine; an unbounded remainder gives NO model;
//   • when nothing remains there is no model — nothing is invented.
// Every value derived here is a LOW-confidence suggestion the builder flags "HEURISTIC_SPLIT".

import { cleanValue, foldForMatching, foldWithMap } from "./normalize";
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
/** At most this many adjacent fragments are rejoined into one manufacturer alias. */
const MAX_REJOINED_FRAGMENTS = 3;

/** True when a value is nothing but a 4-digit year (Western or Arabic-Indic digits) — such a value
 *  is never a make or model name. */
export function isYearLike(value: string): boolean {
  return /^(19|20)\d{2}$/.test(foldForMatching(value));
}

/** One folded word, with the character span [start, end) it came from in its ORIGINAL token. */
type FoldedToken = { folded: string; origIndex: number; start: number; end: number };

/** A token that is a single-word manufacturer alias followed directly by a digit ("مازدا6"). */
function splitGluedManufacturer(part: string): [string, string] | null {
  const m = /^(\D+?)(\d.*)$/u.exec(part);
  if (!m) return null;
  const head = m[1]!;
  const hit = matchManufacturerAt([head], 0);
  return hit && hit.tokenCount === 1 ? [head, m[2]!] : null;
}

/** Tokenize the ORIGINAL (cleaned) text; each original token is folded with a character map so a
 *  folded word knows exactly which characters of the original token it covers. A token that folds
 *  into several words ("pick-up" → "pick", "up"; "مازدا-6" → "مازدا", "6") yields several folded
 *  tokens; a manufacturer glued to its model ("مازدا6") is split as well. */
function tokenize(description: string): { original: string[]; folded: FoldedToken[] } {
  const original = cleanValue(description).split(" ").filter(Boolean);
  const folded: FoldedToken[] = [];
  original.forEach((tok, origIndex) => {
    const { folded: f, map } = foldWithMap(tok);
    const spanOf = (from: number, to: number) => ({ start: map[from] ?? tok.length, end: to < map.length ? map[to]! : tok.length });
    let i = 0;
    while (i < f.length) {
      if (f[i] === " ") { i++; continue; }
      let j = i;
      while (j < f.length && f[j] !== " ") j++;
      const part = f.slice(i, j);
      const glued = splitGluedManufacturer(part);
      if (glued) {
        const cut = i + glued[0].length;
        folded.push({ folded: glued[0], origIndex, ...spanOf(i, cut) });
        folded.push({ folded: glued[1], origIndex, ...spanOf(cut, j) });
      } else {
        folded.push({ folded: part, origIndex, ...spanOf(i, j) });
      }
      i = j;
    }
  });
  return { original, folded };
}

/** A known word (manufacturer or body style) on its own — such a token is never a fragment. */
function isKnownWord(word: string): boolean {
  return matchManufacturerAt([word], 0) !== null || matchBodyStyleAt([word], 0) !== null;
}

/** Rejoin 2..MAX adjacent fragments starting at `at` into ONE single-word manufacturer alias. */
function matchRejoinedManufacturer(words: readonly string[], at: number): { canonical: string; tokenCount: number } | null {
  for (let n = MAX_REJOINED_FRAGMENTS; n >= 2; n--) {
    if (at + n > words.length) continue;
    const parts = words.slice(at, at + n);
    if (parts.some((p) => isKnownWord(p) || /\d/.test(p))) continue;
    const hit = matchManufacturerAt([parts.join("")], 0);
    if (hit && hit.tokenCount === 1) return { canonical: hit.canonical, tokenCount: n };
  }
  return null;
}

/** The text of an original token that is NOT covered by any consumed span, trimmed of the
 *  punctuation that separated it from the consumed part ("مازدا-6" minus "مازدا" → "6"). */
function leftoverText(token: string, consumedSpans: { start: number; end: number }[]): string {
  if (consumedSpans.length === 0) return token;
  let out = "";
  let pos = 0;
  for (const s of [...consumedSpans].sort((a, b) => a.start - b.start)) {
    if (s.start > pos) out += token.slice(pos, s.start) + " ";
    pos = Math.max(pos, s.end);
  }
  out += token.slice(pos);
  return out
    .split(" ")
    .map((p) => p.replace(/^[\s\-–—_/\\|.,:;،؛]+|[\s\-–—_/\\|.,:;،؛]+$/gu, ""))
    .filter(Boolean)
    .join(" ");
}

function scan(words: readonly string[], allowRejoin: boolean): { makes: string[]; bodyStyles: BodyStyleKey[]; consumed: Set<number> } {
  const makes: string[] = [];
  const bodyStyles: BodyStyleKey[] = [];
  const consumed = new Set<number>(); // indexes into `folded`
  let i = 0;
  while (i < words.length) {
    const m = matchManufacturerAt(words, i) ?? (allowRejoin ? matchRejoinedManufacturer(words, i) : null);
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
  return { makes, bodyStyles, consumed };
}

export function splitVehicleDescription(description: string): VehicleDescriptionOutcome {
  const { original, folded } = tokenize(description);
  if (folded.length === 0) return { ok: false, reason: "EMPTY" };
  const words = folded.map((t) => t.folded);

  // Exact tokens first; fragment rejoining is tried only when no manufacturer was found at all.
  let result = scan(words, false);
  if (result.makes.length === 0) result = scan(words, true);
  const { makes, bodyStyles, consumed } = result;

  const distinctMakes = Array.from(new Set(makes));
  if (distinctMakes.length === 0) return { ok: false, reason: "UNKNOWN_MANUFACTURER" };
  if (distinctMakes.length > 1) return { ok: false, reason: "AMBIGUOUS_MANUFACTURER" };
  const make = distinctMakes[0]!;

  // The model is what is left, in the document's own spelling: the characters of each original
  // token not covered by a consumed (manufacturer / body-style) word; bare 4-digit years dropped.
  const consumedByToken = new Map<number, { start: number; end: number }[]>();
  folded.forEach((t, idx) => {
    if (!consumed.has(idx)) return;
    const list = consumedByToken.get(t.origIndex) ?? [];
    list.push({ start: t.start, end: t.end });
    consumedByToken.set(t.origIndex, list);
  });
  const modelTokens = original
    .flatMap((tok, idx) => leftoverText(tok, consumedByToken.get(idx) ?? []).split(" "))
    .filter((tok) => tok.length > 0 && !isYearLike(tok) && foldForMatching(tok).length > 0);

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
