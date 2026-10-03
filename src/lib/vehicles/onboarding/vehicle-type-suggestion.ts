// Phase 3C — Vehicle Creation from Registration, Slice 3B. PURE, no I/O. Suggests a canonical
// vehicle-type CODE from free extracted registration text (make/model/usage descriptors), ONLY
// when a confident keyword match exists. The provider always reviews and may override; an
// ambiguous or empty input yields `null` (nothing pre-selected) — this never guesses.
//
// The result is ALWAYS either a member of TOUR_VEHICLE_CODES or null — it never invents a code.

import { VEHICLE_TYPE_CODES, isVehicleTypeCode } from "@/lib/vehicles/vehicle-type-codes";

// Ordered most-specific → least-specific so e.g. "4x4 SUV" resolves to FOUR_BY_FOUR, not SUV.
const RULES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "FOUR_BY_FOUR", pattern: /\b4\s?[x×]\s?4\b|\b4wd\b|\bawd\b|four[\s-]?wheel|دفع\s*رباعي/i },
  { code: "MINIBUS", pattern: /mini[\s-]?bus|حافلة\s*صغيرة|ميني\s*باص/i },
  { code: "VAN", pattern: /\bvan\b|فان|ميني\s*فان/i },
  { code: "SUV", pattern: /\bsuv\b|sport\s*utility|دفع\s*كلي/i },
  { code: "SEDAN", pattern: /\bsedan\b|saloon|صالون|سيدان/i },
];

/**
 * @param text joined free-text hints (e.g. extracted make/model/usage). Null/empty → null.
 * @returns a TOUR_VEHICLE_CODES member on a confident match, else null (never "OTHER" — the
 *   provider chooses OTHER deliberately; we do not default into it).
 */
export function suggestVehicleType(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t.length === 0) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(t) && isVehicleTypeCode(rule.code)) return rule.code;
  }
  return null;
}

// Re-export for callers that render the full selectable list beside the suggestion.
export { VEHICLE_TYPE_CODES };
