// Phase 3C (Oman field-mapping correction, 2026-10-09) — PURE, deterministic decomposition of the
// COMPOUND vehicle description an Omani registration prints under "نوع المركبة" (usually
// brand + body style + model in one line, e.g. a brand, then "station", then a model name).
//
// The rules are deliberately CONSERVATIVE:
//   • a manufacturer is recognized ONLY from a bounded, general dictionary of brand names (Arabic
//     and Latin spellings) and ONLY at the START of the description — nothing is guessed;
//   • body-style words (station, wagon, sedan, pickup, van, bus, …) are removed from the model
//     name and reported separately as a body-style HINT (a provider still chooses the type);
//   • whatever remains is the commercial model name; if nothing remains, there is no model;
//   • if the manufacturer is not recognized the description is NOT split at all — the caller
//     leaves make and model unresolved and shows the original description for the provider.
// A split result is always a LOW-confidence suggestion that needs review; the shared builder
// marks it "HEURISTIC_SPLIT". The returned make/model keep the document's own spelling (never
// translated or canonicalized). No I/O, no PII.

import { cleanValue, toWesternDigits } from "./normalize";

/** Brand names as they may be printed (Latin and Arabic). Multi-word first. General, not tuned to
 *  one vehicle; extend by adding spellings, never by adding model names. */
const MANUFACTURERS: readonly string[] = [
  // multi-word
  "land rover", "لاند روفر", "mercedes benz", "mercedes-benz", "مرسيدس بنز", "alfa romeo", "aston martin", "rolls royce", "rolls-royce", "great wall", "جريت وول", "king long", "كينج لونج", "ashok leyland",
  // single-word
  "toyota", "تويوتا", "nissan", "نيسان", "hyundai", "هيونداي", "هيونداى", "kia", "كيا", "mitsubishi", "ميتسوبيشي", "lexus", "لكزس", "honda", "هوندا", "ford", "فورد",
  "chevrolet", "شيفروليه", "شفروليه", "شيفرولية", "gmc", "جي ام سي", "جي إم سي", "mercedes", "مرسيدس", "bmw", "بي ام دبليو", "بي إم دبليو", "audi", "أودي", "اودي",
  "isuzu", "إيسوزو", "ايسوزو", "suzuki", "سوزوكي", "mazda", "مازدا", "volkswagen", "فولكس واجن", "فولكسفاجن", "jeep", "جيب", "dodge", "دودج", "renault", "رينو",
  "peugeot", "بيجو", "mg", "ام جي", "إم جي", "changan", "شانجان", "geely", "جيلي", "haval", "هافال", "jac", "جاك", "infiniti", "انفينيتي", "إنفينيتي", "cadillac", "كاديلاك",
  "chrysler", "كرايسلر", "subaru", "سوبارو", "volvo", "فولفو", "porsche", "بورش", "tesla", "تيسلا", "byd", "بي واي دي", "jetour", "جيتور", "chery", "شيري",
  "daihatsu", "دايهاتسو", "hino", "هينو", "lincoln", "لينكولن", "ram", "رام", "foton", "فوتون", "yutong", "يوتونج", "tata", "تاتا", "scania", "سكانيا", "man", "مان",
  "mitsubishi fuso", "fuso", "فوسو", "maxus", "ماكسس", "exeed", "اكسيد", "إكسيد", "omoda", "أومودا", "jaecoo", "lynk", "zeekr", "seat", "skoda", "سكودا", "opel", "أوبل", "اوبل",
  "fiat", "فيات", "citroen", "سيتروين", "mini", "ميني", "genesis", "جينيسيس", "acura", "buick", "بيوك", "hummer", "هامر", "lada", "لادا", "proton", "بروتون", "ssangyong", "سانج يونج",
];

/** Body-style words that describe the body, not the model — stripped from the model name and
 *  returned as a hint. Kept general. */
const BODY_STYLE_WORDS: readonly string[] = [
  "station", "استيشن", "ستيشن", "wagon", "واجن", "sedan", "سيدان", "صالون", "saloon", "hatchback", "هاتشباك",
  "pickup", "pick-up", "بيك اب", "بيكب", "بكب", "van", "فان", "bus", "باص", "حافلة", "minibus", "ميني باص", "coupe", "كوبيه",
  "suv", "4x4", "4×4", "دفع رباعي", "truck", "شاحنة", "double cab", "دبل كاب", "single cab", "سنجل كاب", "crew cab", "cabin", "كابينة", "convertible", "كشف",
];

export type VehicleDescriptionSplit = {
  /** The manufacturer as printed (document spelling). */
  make: string;
  /** The commercial model name as printed, body-style words removed; null when nothing remains. */
  model: string | null;
  /** Body-style words found (document spelling), joined — a HINT for the vehicle-type suggestion. */
  bodyStyle: string | null;
};

const fold = (s: string) => toWesternDigits(cleanValue(s)).toLowerCase();

/** Split a compound description into manufacturer / model / body style, or null when the
 *  manufacturer is not recognized at the start (then nothing is split — never a guess). */
export function splitVehicleDescription(description: string): VehicleDescriptionSplit | null {
  const original = cleanValue(description);
  if (original.length === 0) return null;
  const tokens = original.split(" ");
  const folded = tokens.map(fold);

  let makeLen = 0;
  for (const name of MANUFACTURERS) {
    const parts = name.split(" ");
    if (parts.length > tokens.length) continue;
    const head = folded.slice(0, parts.length).join(" ");
    if (head === name.toLowerCase() && parts.length > makeLen) makeLen = parts.length;
  }
  if (makeLen === 0) return null;

  const make = tokens.slice(0, makeLen).join(" ");
  const rest = tokens.slice(makeLen);
  const restFolded = folded.slice(makeLen);
  const bodyWords: string[] = [];
  const modelWords: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    // two-word body styles first ("double cab", "دفع رباعي"), then single words
    const two = i + 1 < rest.length ? `${restFolded[i]} ${restFolded[i + 1]}` : null;
    if (two && BODY_STYLE_WORDS.includes(two)) {
      bodyWords.push(`${rest[i]} ${rest[i + 1]}`);
      i++;
      continue;
    }
    if (BODY_STYLE_WORDS.includes(restFolded[i]!)) bodyWords.push(rest[i]!);
    else modelWords.push(rest[i]!);
  }
  return {
    make,
    model: modelWords.length > 0 ? modelWords.join(" ") : null,
    bodyStyle: bodyWords.length > 0 ? bodyWords.join(" ") : null,
  };
}

/** True when a value is nothing but a 4-digit year (Western or Arabic-Indic digits) — such a value
 *  is never a make or model name. */
export function isYearLike(value: string): boolean {
  return /^(19|20)\d{2}$/.test(toWesternDigits(cleanValue(value)));
}
