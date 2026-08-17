import { z } from "zod";
import { TOUR_PACKAGE_KEYS, TOUR_PACKAGE_SEMANTICS } from "./packages";
import { TOUR_VEHICLE_CODES, MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR, MAX_VEHICLE_PASSENGER_CAPACITY } from "./vehicle-types";

// Smart Tour-Guide Template — the STRICT, VERSIONED server-side contract for
// Experience.guidingContent. This is the security boundary: Experience.guiding-
// Content is a Json column, but a provider (web/native) may NEVER write arbitrary
// JSON to it — every write MUST pass parseGuidingContent() first.
//
// Guarantees:
//   - `.strict()` at every object level => ANY unknown/unexpected key is rejected,
//     so private/sensitive data (registrationNumber, objectKey, phone, ID
//     numbers, signed URLs, ...) can never slip in — there is simply no slot for it.
//   - version is a literal => only the current contract shape is accepted.
//   - all strings are trimmed, length-bounded, and rejected if they contain HTML
//     tags or control characters (no executable/markup content; render layers
//     still escape).
//   - all numbers/arrays are range/size bounded.
//   - package->vehicle INVARIANTS are enforced here (superRefine), independent of
//     any admin TourTemplateFieldRule — DB config can never relax them.
//
// Zod is used deliberately (already a dependency): a strict nested contract with
// conditional refinement is exactly its remit, and the user directed a Zod
// contract for this foundation.

export const GUIDING_CONTENT_VERSION = 1 as const;

export const TOUR_DIFFICULTY_LEVELS = ["EASY", "MODERATE", "CHALLENGING", "DIFFICULT"] as const;
export type TourDifficulty = (typeof TOUR_DIFFICULTY_LEVELS)[number];

// Reject HTML-tag-like content. Render layers still escape; this is defense in depth.
const HTML_TAG = /<\/?[a-z][\s\S]*?>/i;

// Reject disallowed C0 control characters. Tab (9), newline (10) and carriage-
// return (13) are permitted (multi-line notes); every other char below 32 is
// rejected. Implemented as a code-point scan so no literal control byte or escape
// appears in source.
function hasDisallowedControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      return true;
    }
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

// A nullable free-text field: blank/whitespace normalizes to null (not an error),
// otherwise it must be valid plain text within bounds.
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
function nullableText(max: number) {
  return z.preprocess(emptyToNull, plainText(max).nullable());
}

const vehicleSchema = z
  .object({
    type: z.enum(TOUR_VEHICLE_CODES),
    make: nullableText(100),
    model: nullableText(100),
    year: z.number().int().min(MIN_VEHICLE_YEAR).max(MAX_VEHICLE_YEAR).nullable(),
    passengerCapacity: z.number().int().min(1).max(MAX_VEHICLE_PASSENGER_CAPACITY).nullable(),
  })
  .strict();

const itineraryStopSchema = z
  .object({
    title: plainText(200),
    description: nullableText(1000),
  })
  .strict();

export const guidingContentSchema = z
  .object({
    version: z.literal(GUIDING_CONTENT_VERSION),
    packageType: z.enum(TOUR_PACKAGE_KEYS),
    durationMinutes: z.number().int().min(1).max(20160).nullable(), // <= 14 days
    meetingPoint: nullableText(500),
    pickup: z
      .object({
        included: z.boolean(),
        area: nullableText(500),
        hotelPickup: z.boolean(),
        airportPickup: z.boolean(),
      })
      .strict(),
    maxGuests: z.number().int().min(1).max(1000).nullable(),
    languages: z.array(plainText(40)).max(20),
    itinerary: z.array(itineraryStopSchema).max(50),
    includedItems: z.array(plainText(200)).max(50),
    excludedItems: z.array(plainText(200)).max(50),
    difficulty: z.enum(TOUR_DIFFICULTY_LEVELS).nullable(),
    childFriendly: z.boolean().nullable(),
    privateTour: z.boolean().nullable(),
    recommendedEquipment: z.array(plainText(100)).max(30),
    refreshmentsIncluded: z.boolean().nullable(),
    importantNotes: nullableText(2000),
    vehicle: vehicleSchema.nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // App-owned package->vehicle invariants. These win over any admin config.
    const semantics = TOUR_PACKAGE_SEMANTICS[data.packageType];

    // GUIDE_ONLY (no transport, not optional) => vehicle MUST be absent.
    if (!semantics.includesTransport && !semantics.vehicleOptional && data.vehicle !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vehicle"],
        message: "vehicle details are not allowed for this package",
      });
    }

    // Transport packages => vehicle REQUIRED.
    if (semantics.includesTransport && data.vehicle === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vehicle"],
        message: "vehicle details are required for this package",
      });
    }

    // GUIDE_WITH_4X4 => vehicle.type MUST be FOUR_BY_FOUR.
    if (semantics.requiresFourByFour && data.vehicle !== null && data.vehicle.type !== "FOUR_BY_FOUR") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vehicle", "type"],
        message: "this package requires a FOUR_BY_FOUR vehicle",
      });
    }
  });

export type GuidingContent = z.infer<typeof guidingContentSchema>;

export type GuidingContentParseResult =
  | { ok: true; value: GuidingContent }
  | { ok: false; errors: string[] };

// The ONLY sanctioned way to turn untrusted input into a storable guidingContent
// value. Returns the normalized (trimmed, null-coalesced) object on success, or a
// flat list of "path: message" errors on failure. Never throws.
export function parseGuidingContent(input: unknown): GuidingContentParseResult {
  const result = guidingContentSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}
