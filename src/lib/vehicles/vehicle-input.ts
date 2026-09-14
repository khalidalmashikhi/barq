import { z } from "zod";
import {
  TOUR_VEHICLE_CODES,
  MIN_VEHICLE_YEAR,
  MAX_VEHICLE_YEAR,
  MAX_VEHICLE_PASSENGER_CAPACITY,
} from "@/lib/tour-template/vehicle-types";

// VEHICLE-1 — the single strict, server-authoritative input contract for a
// provider-owned Vehicle. Every create/update goes through parseVehicleInput();
// no route/UI validation is ever the authority.
//
// The canonical vehicle-type vocabulary + numeric bounds are REUSED from the
// app-owned registry (src/lib/tour-template/vehicle-types) — a pure, dependency-
// free module — so there is exactly ONE vehicle-type vocabulary in BARQ, never a
// competing one. (Importing that constant touches no tour LOGIC.)
//
// Text-safety mirrors the guiding-content.ts convention: trim, reject
// empty-after-trim, bound length, and reject HTML-tag-like or control-character
// payloads (defense in depth; render layers still escape).

// Reject HTML-tag-like content.
const HTML_TAG = /<\/?[a-z][\s\S]*?>/i;

// Reject disallowed C0 control characters (tab/newline/CR permitted). Code-point
// scan so no literal control byte appears in source.
function hasDisallowedControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !HTML_TAG.test(s), { message: "must not contain HTML/markup" })
    .refine((s) => !hasDisallowedControlChar(s), { message: "must not contain control characters" });
}

// Blank/whitespace/undefined normalizes to null; otherwise valid bounded text.
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v ?? null);
function nullableText(max: number) {
  return z.preprocess(emptyToNull, plainText(max).nullable());
}

// A nullable integer: undefined/null/"" → null; otherwise a bounded integer.
function nullableInt(min: number, max: number) {
  return z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? null : v),
    z.number().int().min(min).max(max).nullable(),
  );
}

// Registration/plate — PRIVATE + OPTIONAL. Conservatively normalized (trim,
// collapse inner whitespace, upper-case) but NO invented Oman plate format:
// BARQ defines none, so we only sanitise, never impose a shape. Blank → null.
const registrationNumber = z.preprocess((v) => {
  if (typeof v !== "string") return v ?? null;
  const normalized = v.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized === "" ? null : normalized;
}, z.string().min(1).max(32).refine((s) => !HTML_TAG.test(s), { message: "invalid" }).refine((s) => !hasDisallowedControlChar(s), { message: "invalid" }).nullable());

// Re-export the shared vocabulary under a vehicle-domain name so call sites need
// not reach into tour-template directly.
export const VEHICLE_TYPE_CODES = TOUR_VEHICLE_CODES;
export type VehicleTypeCode = (typeof VEHICLE_TYPE_CODES)[number];

export const vehicleInputSchema = z
  .object({
    make: plainText(100),
    model: plainText(100),
    modelYear: nullableInt(MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR),
    color: nullableText(50),
    vehicleType: z.enum(TOUR_VEHICLE_CODES),
    // BOOKABLE customer passenger capacity (excludes driver + operating guide) — TOUR-
    // VEHICLE-CAP + Slice B locked semantic. NOT total physical seats. The wire/form key
    // stays `passengerCapacity` (external contract); the persistence field is
    // bookablePassengerCapacity. Required and bounded by the shared platform ceiling.
    passengerCapacity: z.number().int().min(1).max(MAX_VEHICLE_PASSENGER_CAPACITY),
    // Slice B — official registered total seats (informational). Nullable/optional: when
    // absent it stays null (never invented, never backfilled). When supplied it must be a
    // positive integer within the same platform ceiling. The cross-field rule below then
    // requires bookable capacity <= registered seats (you cannot let more customers book
    // than the vehicle is registered to seat).
    registeredSeats: nullableInt(1, MAX_VEHICLE_PASSENGER_CAPACITY),
    publicDescription: nullableText(500),
    registrationNumber,
    // TOUR-VEHICLE-CAP — the PROVIDER's advisory 4x4 declaration only. The trusted
    // capability (Vehicle.fourByFourVerified) is admin-only and is NEVER accepted here.
    claimedFourByFour: z.boolean().nullable().default(null),
  })
  .strict()
  // Cross-field: bookable customer capacity may not exceed the KNOWN registered seat count.
  // When registeredSeats is null (unknown) the bookable value stands on its own — a provider
  // without the registration figure can still record operational capacity. Server-authoritative;
  // never silently clamped — an impossible pair is rejected as INVALID_INPUT.
  .refine((v) => v.registeredSeats === null || v.passengerCapacity <= v.registeredSeats, {
    message: "bookable passenger capacity cannot exceed registered seats",
    path: ["passengerCapacity"],
  });

export type VehicleInput = z.infer<typeof vehicleInputSchema>;

// Parse + normalize raw input. Returns a discriminated result rather than
// throwing, so domain callers map failure to a stable INVALID_INPUT error.
export function parseVehicleInput(raw: unknown): { ok: true; value: VehicleInput } | { ok: false } {
  const result = vehicleInputSchema.safeParse(raw);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}
