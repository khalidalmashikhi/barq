// Phase 3C — Vehicle Creation from Registration, Slice 3B. PURE, no I/O. Suggests a canonical
// vehicle-type CODE from free extracted registration text (the compound description, make, model
// or usage words), ONLY when a GOVERNED body-style alias matches (body-style-registry.ts: Arabic
// and English, folded so presentation-form glyphs / diacritics / tatweel do not matter). The
// provider always reviews and may override; an ambiguous or empty input yields `null` (nothing
// pre-selected) — this never guesses, and the suggestion is never applied by itself.
//
// The result is ALWAYS either a member of VEHICLE_TYPE_CODES or null — it never invents a code.

import { VEHICLE_TYPE_CODES, isVehicleTypeCode } from "@/lib/vehicles/vehicle-type-codes";
import { suggestVehicleTypeFromText } from "@/lib/vehicles/registration-extraction/vehicle-description";

/**
 * @param text joined free-text hints (e.g. extracted description/make/model/usage). Null/empty → null.
 * @returns a VEHICLE_TYPE_CODES member on a confident match, else null (never "OTHER" — the
 *   provider chooses OTHER deliberately; we do not default into it).
 */
export function suggestVehicleType(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t.length === 0) return null;
  const code = suggestVehicleTypeFromText(t);
  return code && isVehicleTypeCode(code) && code !== "OTHER" ? code : null;
}

// Re-export for callers that render the full selectable list beside the suggestion.
export { VEHICLE_TYPE_CODES };
