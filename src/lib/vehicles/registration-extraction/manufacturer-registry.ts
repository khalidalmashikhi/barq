// Phase 3C (Oman parsing discrepancy correction, 2026-10-09) — GOVERNED manufacturer registry.
// A bounded, testable list of canonical manufacturer names with their common Arabic and Latin
// spellings. Used ONLY to recognize a manufacturer inside a registration's compound description
// (or an explicit make value) and to emit the CANONICAL name; anything not listed stays
// unresolved — nothing is ever guessed. Extend by adding aliases; never add model names.
//
// Aliases are matched on the FOLDED form (see normalize.ts: NFKC, no diacritics / tatweel /
// punctuation, Western digits, lower case), so presentation-form glyphs, "مــازدا" or "مَازْدَا"
// all resolve like "مازدا". Multi-word aliases are matched as whole token sequences.

import { foldForMatching } from "./normalize";

export type ManufacturerEntry = { canonical: string; aliases: readonly string[] };

export const MANUFACTURER_REGISTRY: readonly ManufacturerEntry[] = [
  { canonical: "Toyota", aliases: ["toyota", "تويوتا"] },
  { canonical: "Nissan", aliases: ["nissan", "نيسان"] },
  { canonical: "Mazda", aliases: ["mazda", "مازدا"] },
  { canonical: "Hyundai", aliases: ["hyundai", "هيونداي", "هيونداى", "هونداي"] },
  { canonical: "Kia", aliases: ["kia", "كيا"] },
  { canonical: "Ford", aliases: ["ford", "فورد"] },
  { canonical: "Chevrolet", aliases: ["chevrolet", "chevy", "شفروليه", "شيفروليه", "شيفرولية"] },
  { canonical: "Mitsubishi", aliases: ["mitsubishi", "ميتسوبيشي", "متسوبيشي"] },
  { canonical: "Lexus", aliases: ["lexus", "لكزس", "ليكزس"] },
  { canonical: "Honda", aliases: ["honda", "هوندا"] },
  { canonical: "Suzuki", aliases: ["suzuki", "سوزوكي"] },
  { canonical: "Isuzu", aliases: ["isuzu", "ايسوزو", "إيسوزو", "أيسوزو"] },
  { canonical: "Mercedes-Benz", aliases: ["mercedes-benz", "mercedes benz", "mercedes", "مرسيدس بنز", "مرسيدس"] },
  { canonical: "BMW", aliases: ["bmw", "بي ام دبليو", "بي إم دبليو", "بي ام دبيلو"] },
  { canonical: "Volkswagen", aliases: ["volkswagen", "vw", "فولكس واجن", "فولكسفاجن", "فولكس فاجن"] },
  { canonical: "Land Rover", aliases: ["land rover", "landrover", "لاند روفر", "لاندروفر"] },
  { canonical: "MG", aliases: ["mg", "ام جي", "إم جي", "ام جى"] },
  { canonical: "GMC", aliases: ["gmc", "جي ام سي", "جي إم سي"] },
  { canonical: "Audi", aliases: ["audi", "أودي", "اودي"] },
  { canonical: "Jeep", aliases: ["jeep", "جيب"] },
  { canonical: "Dodge", aliases: ["dodge", "دودج"] },
  { canonical: "Renault", aliases: ["renault", "رينو"] },
  { canonical: "Peugeot", aliases: ["peugeot", "بيجو"] },
  { canonical: "Changan", aliases: ["changan", "شانجان", "شانغان"] },
  { canonical: "Geely", aliases: ["geely", "جيلي"] },
  { canonical: "Haval", aliases: ["haval", "هافال"] },
  { canonical: "JAC", aliases: ["jac", "جاك"] },
  { canonical: "Infiniti", aliases: ["infiniti", "انفينيتي", "إنفينيتي"] },
  { canonical: "Cadillac", aliases: ["cadillac", "كاديلاك"] },
  { canonical: "Chrysler", aliases: ["chrysler", "كرايسلر"] },
  { canonical: "Subaru", aliases: ["subaru", "سوبارو"] },
  { canonical: "Volvo", aliases: ["volvo", "فولفو"] },
  { canonical: "Porsche", aliases: ["porsche", "بورش", "بورشه"] },
  { canonical: "Tesla", aliases: ["tesla", "تيسلا", "تسلا"] },
  { canonical: "BYD", aliases: ["byd", "بي واي دي"] },
  { canonical: "Jetour", aliases: ["jetour", "جيتور"] },
  { canonical: "Chery", aliases: ["chery", "شيري"] },
  { canonical: "Daihatsu", aliases: ["daihatsu", "دايهاتسو"] },
  { canonical: "Hino", aliases: ["hino", "هينو"] },
  { canonical: "Lincoln", aliases: ["lincoln", "لينكولن"] },
  { canonical: "RAM", aliases: ["ram", "رام"] },
  { canonical: "Foton", aliases: ["foton", "فوتون"] },
  { canonical: "Yutong", aliases: ["yutong", "يوتونج", "يوتونغ"] },
  { canonical: "Tata", aliases: ["tata", "تاتا"] },
  { canonical: "Scania", aliases: ["scania", "سكانيا"] },
  { canonical: "MAN", aliases: ["man", "مان"] },
  { canonical: "Maxus", aliases: ["maxus", "ماكسس"] },
  { canonical: "Exeed", aliases: ["exeed", "اكسيد", "إكسيد"] },
  { canonical: "Omoda", aliases: ["omoda", "أومودا", "اومودا"] },
  { canonical: "Skoda", aliases: ["skoda", "سكودا"] },
  { canonical: "Opel", aliases: ["opel", "أوبل", "اوبل"] },
  { canonical: "Fiat", aliases: ["fiat", "فيات"] },
  { canonical: "Citroën", aliases: ["citroen", "citroën", "سيتروين"] },
  { canonical: "Mini", aliases: ["mini", "ميني"] },
  { canonical: "Genesis", aliases: ["genesis", "جينيسيس", "جنسس"] },
  { canonical: "Hummer", aliases: ["hummer", "هامر"] },
  { canonical: "Lada", aliases: ["lada", "لادا"] },
  { canonical: "Proton", aliases: ["proton", "بروتون"] },
  { canonical: "SsangYong", aliases: ["ssangyong", "سانج يونج", "سانغ يونغ"] },
  { canonical: "Great Wall", aliases: ["great wall", "جريت وول"] },
  { canonical: "King Long", aliases: ["king long", "كينج لونج"] },
  { canonical: "Alfa Romeo", aliases: ["alfa romeo", "الفا روميو", "ألفا روميو"] },
  { canonical: "Aston Martin", aliases: ["aston martin", "استون مارتن", "أستون مارتن"] },
  { canonical: "Rolls-Royce", aliases: ["rolls-royce", "rolls royce", "رولز رويس"] },
];

type AliasEntry = { tokens: string[]; canonical: string };
const ALIAS_INDEX: AliasEntry[] = MANUFACTURER_REGISTRY.flatMap((m) =>
  m.aliases.map((a) => ({ tokens: foldForMatching(a).split(" ").filter(Boolean), canonical: m.canonical })),
).sort((a, b) => b.tokens.length - a.tokens.length); // longest alias first ("land rover" before "rover"-like single words)

export type ManufacturerMatch = { canonical: string; tokenCount: number };

/** Match a manufacturer alias starting EXACTLY at `tokens[at]` (folded tokens). Longest alias wins. */
export function matchManufacturerAt(tokens: readonly string[], at: number): ManufacturerMatch | null {
  for (const alias of ALIAS_INDEX) {
    if (at + alias.tokens.length > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < alias.tokens.length; i++) if (tokens[at + i] !== alias.tokens[i]) { ok = false; break; }
    if (ok) return { canonical: alias.canonical, tokenCount: alias.tokens.length };
  }
  return null;
}

/** The canonical name for a value that IS a manufacturer alias (whole string), else null. */
export function canonicalManufacturer(value: string): string | null {
  const tokens = foldForMatching(value).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const m = matchManufacturerAt(tokens, 0);
  return m && m.tokenCount === tokens.length ? m.canonical : null;
}
