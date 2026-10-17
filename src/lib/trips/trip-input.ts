import { z } from "zod";
import { REGION_CODES, type RegionCode } from "@/lib/regions";
import { isOmanPastDateKey, parseOmanDateKey } from "@/lib/date/oman-time";

// 2026-10-17 — Trip planner, grounded foundation (owner-approved roadmap exception; deterministic,
// no AI call). PURE input contract shared by the web page and `/api/v1/trips/*` (ADR-0011).
//
// The quick version needs only a REGION and a NUMBER OF DAYS. Everything else is optional and
// non-sensitive: no name, phone, email, identity document, vehicle registration or payment data is
// ever asked for or accepted — unknown keys are rejected, never silently stored or forwarded.

export const TRIP_MAX_DAYS = 7;
export const TRIP_MAX_PARTY = 20;
/** How far ahead a start date may be (days). */
export const TRIP_MAX_START_OFFSET_DAYS = 365;

export const TRIP_INTERESTS = ["nature", "beaches", "mountains", "heritage", "adventure", "family", "food", "shopping"] as const;
export const TRIP_PACES = ["relaxed", "balanced", "intensive"] as const;
export const TRIP_MOBILITY = ["own", "rental", "guided"] as const;

export type TripInterest = (typeof TRIP_INTERESTS)[number];
export type TripPace = (typeof TRIP_PACES)[number];
export type TripMobility = (typeof TRIP_MOBILITY)[number];

const tripInputSchema = z
  .object({
    regionCode: z.enum(REGION_CODES as unknown as [RegionCode, ...RegionCode[]]),
    days: z.number().int().min(1).max(TRIP_MAX_DAYS),
    startDate: z.string().optional(),
    adults: z.number().int().min(1).max(TRIP_MAX_PARTY).optional(),
    children: z.number().int().min(0).max(TRIP_MAX_PARTY).optional(),
    interests: z.array(z.enum(TRIP_INTERESTS)).max(TRIP_INTERESTS.length).optional(),
    pace: z.enum(TRIP_PACES).optional(),
    /** Approximate budget per person for the whole trip, in OMR (whole units). */
    budgetPerPerson: z.number().int().min(1).max(100_000).optional(),
    mobility: z.enum(TRIP_MOBILITY).optional(),
    needs: z.object({ accessibility: z.boolean().optional(), family: z.boolean().optional() }).strict().optional(),
  })
  .strict();

export type TripInput = {
  regionCode: RegionCode;
  days: number;
  /** Oman date key (YYYY-MM-DD) of day 1, or null when the customer did not give dates. */
  startDate: string | null;
  adults: number;
  children: number;
  interests: TripInterest[];
  pace: TripPace;
  budgetPerPerson: number | null;
  mobility: TripMobility;
  needs: { accessibility: boolean; family: boolean };
};

export type TripInputResult = { ok: true; value: TripInput } | { ok: false; fields: string[] };

/** Parse untrusted input (a JSON body) into a normalised TripInput, or the offending field names. */
export function parseTripInput(raw: unknown, now: Date = new Date()): TripInputResult {
  const parsed = tripInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => (i.path.length > 0 ? String(i.path[0]) : i.code === "unrecognized_keys" ? "unknown" : "input")))];
    return { ok: false, fields };
  }
  const v = parsed.data;
  let startDate: string | null = null;
  if (v.startDate !== undefined && v.startDate !== "") {
    const key = parseOmanDateKey(v.startDate);
    if (!key || isOmanPastDateKey(key, now)) return { ok: false, fields: ["startDate"] };
    const limit = new Date(now.getTime() + TRIP_MAX_START_OFFSET_DAYS * 86_400_000);
    if (new Date(`${key}T00:00:00Z`).getTime() > limit.getTime()) return { ok: false, fields: ["startDate"] };
    startDate = key;
  }
  const adults = v.adults ?? 2;
  const children = v.children ?? 0;
  if (adults + children > TRIP_MAX_PARTY) return { ok: false, fields: ["children"] };
  return {
    ok: true,
    value: {
      regionCode: v.regionCode,
      days: v.days,
      startDate,
      adults,
      children,
      interests: [...new Set(v.interests ?? [])],
      pace: v.pace ?? "balanced",
      budgetPerPerson: v.budgetPerPerson ?? null,
      mobility: v.mobility ?? "own",
      needs: { accessibility: v.needs?.accessibility === true, family: v.needs?.family === true },
    },
  };
}

/** The Oman date keys of the trip days (null entries when no start date was given). */
export function tripDateKeys(input: Pick<TripInput, "startDate" | "days">): (string | null)[] {
  if (!input.startDate) return Array.from({ length: input.days }, () => null);
  const base = new Date(`${input.startDate}T00:00:00Z`).getTime();
  return Array.from({ length: input.days }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

/** A stable fingerprint of the preferences a plan was generated from (stale-response guard). */
export function tripInputSignature(input: TripInput): string {
  return JSON.stringify([input.regionCode, input.days, input.startDate, input.adults, input.children, [...input.interests].sort(), input.pace, input.budgetPerPerson, input.mobility, input.needs.accessibility, input.needs.family]);
}
