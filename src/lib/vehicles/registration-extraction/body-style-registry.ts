// Phase 3C (Oman parsing discrepancy correction, 2026-10-09) — GOVERNED body-style registry.
// Arabic / English words a registration prints as the BODY STYLE inside its compound description
// ("مازدا صالون 6", "nissan station modelname"). Two jobs, nothing more:
//   1. recognize and REMOVE the body word so it never pollutes the commercial model name;
//   2. map it, where BARQ already has such a type, to a vehicle-type SUGGESTION code — only the
//      existing public taxonomy (SEDAN / SUV / FOUR_BY_FOUR / VAN / MINIBUS); styles BARQ does not
//      model (hatchback, coupe, pickup, truck, station wagon) are recognized but suggest nothing.
// A suggestion is never applied by itself — the provider chooses the type explicitly.

import { foldForMatching } from "./normalize";
import type { VehicleTypeCode } from "@/lib/vehicles/vehicle-type-codes";

export type BodyStyleKey = "SEDAN" | "SUV" | "FOUR_BY_FOUR" | "HATCHBACK" | "COUPE" | "PICKUP" | "BUS" | "MINIBUS" | "VAN" | "TRUCK" | "STATION_WAGON" | "CONVERTIBLE";

export type BodyStyleEntry = { key: BodyStyleKey; vehicleType: VehicleTypeCode | null; aliases: readonly string[] };

export const BODY_STYLE_REGISTRY: readonly BodyStyleEntry[] = [
  { key: "FOUR_BY_FOUR", vehicleType: "FOUR_BY_FOUR", aliases: ["4x4", "4×4", "4wd", "awd", "دفع رباعي", "دفع رباعى", "رباعي الدفع", "four wheel drive"] },
  { key: "SUV", vehicleType: "SUV", aliases: ["suv", "رباعي", "دفع كلي", "sport utility"] },
  { key: "SEDAN", vehicleType: "SEDAN", aliases: ["sedan", "saloon", "صالون", "سيدان", "سالون"] },
  { key: "MINIBUS", vehicleType: "MINIBUS", aliases: ["minibus", "mini bus", "حافلة صغيرة", "ميني باص", "مينى باص", "باص صغير"] },
  { key: "BUS", vehicleType: "MINIBUS", aliases: ["bus", "حافلة", "باص", "اتوبيس", "أوتوبيس"] },
  { key: "VAN", vehicleType: "VAN", aliases: ["van", "فان", "ميني فان", "minivan"] },
  { key: "HATCHBACK", vehicleType: null, aliases: ["hatchback", "هاتشباك", "هاتش باك"] },
  { key: "COUPE", vehicleType: null, aliases: ["coupe", "coupé", "كوبيه", "كوبيه"] },
  { key: "PICKUP", vehicleType: null, aliases: ["pickup", "pick up", "pick-up", "بيك أب", "بيك اب", "بيكب", "بكب", "double cab", "دبل كاب", "single cab", "سنجل كاب", "crew cab"] },
  { key: "TRUCK", vehicleType: null, aliases: ["truck", "lorry", "شاحنة", "شاحنه"] },
  { key: "STATION_WAGON", vehicleType: null, aliases: ["station wagon", "station", "wagon", "استيشن", "ستيشن", "واجن", "استيت"] },
  { key: "CONVERTIBLE", vehicleType: null, aliases: ["convertible", "كشف", "كابريوليه"] },
];

type AliasEntry = { tokens: string[]; key: BodyStyleKey; vehicleType: VehicleTypeCode | null };
const ALIAS_INDEX: AliasEntry[] = BODY_STYLE_REGISTRY.flatMap((b) =>
  b.aliases.map((a) => ({ tokens: foldForMatching(a).split(" ").filter(Boolean), key: b.key, vehicleType: b.vehicleType })),
).sort((a, b) => b.tokens.length - a.tokens.length);

export type BodyStyleMatch = { key: BodyStyleKey; vehicleType: VehicleTypeCode | null; tokenCount: number };

/** Match a body-style alias starting EXACTLY at `tokens[at]` (folded tokens). Longest alias wins. */
export function matchBodyStyleAt(tokens: readonly string[], at: number): BodyStyleMatch | null {
  for (const alias of ALIAS_INDEX) {
    if (at + alias.tokens.length > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < alias.tokens.length; i++) if (tokens[at + i] !== alias.tokens[i]) { ok = false; break; }
    if (ok) return { key: alias.key, vehicleType: alias.vehicleType, tokenCount: alias.tokens.length };
  }
  return null;
}

/** Specificity order for a type SUGGESTION when several body words appear ("4x4 SUV" → 4x4). */
const SUGGESTION_PRIORITY: readonly BodyStyleKey[] = ["FOUR_BY_FOUR", "MINIBUS", "BUS", "VAN", "SUV", "SEDAN"];

/** The single most specific vehicle-type suggestion for the body styles found, or null. */
export function suggestTypeFromBodyStyles(keys: readonly BodyStyleKey[]): VehicleTypeCode | null {
  for (const k of SUGGESTION_PRIORITY) {
    if (!keys.includes(k)) continue;
    const entry = BODY_STYLE_REGISTRY.find((b) => b.key === k);
    if (entry?.vehicleType) return entry.vehicleType;
  }
  return null;
}
