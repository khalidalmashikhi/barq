import "server-only";
import { Prisma } from "@prisma/client";

// SERVICE INFORMATION MODEL (Booking Decision Data) — Implementation Gate 1.
//
// The single, server-authoritative parser/validator for the seven additive, service-type-
// neutral Service fields (durationMinutes, startInstructions, inclusions, exclusions,
// customerRequirements, minBookingSeats, maxBookingSeats). Shared by create-service and
// update-service so both apply identical rules. Pure (no I/O) and exhaustively unit-testable.
//
// Tri-state per field, so UPDATE can distinguish "unchanged" from "cleared":
//   undefined  → the form key was absent      → leave the column unchanged (update) / unset (create)
//   null       → present but empty            → clear the column to NULL
//   value      → present + valid              → set the column
//
// Every field is OPTIONAL; there are no fabricated defaults. Client validation is convenience
// only — this is the authority.

export type Bilingual = { ar: string; en: string };
export type BilingualList = { ar: string[]; en: string[] };

export const DURATION_MAX_MINUTES = 525_600; // 1 year — anti-abuse ceiling, not a business rule
export const SEAT_MAX = 1_000; // anti-abuse ceiling on a per-booking seat bound
export const TEXT_MAX = 1_000; // per-language chars for start instructions
export const LIST_MAX_ITEMS = 20;
export const LIST_ITEM_MAX = 200; // per-item chars for inclusion/exclusion/requirement lines

type Tri<T> = T | null | undefined;

export type ServiceInfoFields = {
  durationMinutes: Tri<number>;
  startInstructions: Tri<Bilingual>;
  inclusions: Tri<BilingualList>;
  exclusions: Tri<BilingualList>;
  customerRequirements: Tri<BilingualList>;
  minBookingSeats: Tri<number>;
  maxBookingSeats: Tri<number>;
};

export type ServiceInfoParseResult = { ok: true; fields: ServiceInfoFields } | { ok: false };

function str(v: FormDataEntryValue | null): string | null {
  return typeof v === "string" ? v : v === null ? null : ""; // a File becomes "" (never a valid value)
}

// undefined = key absent; null = present-empty; number = valid integer in [1, max]. Invalid → throw sentinel.
class InvalidField extends Error {}

function parseIntField(raw: FormDataEntryValue | null, max: number): Tri<number> {
  const s = str(raw);
  if (s === null) return undefined;
  const t = s.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) throw new InvalidField();
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new InvalidField();
  return n;
}

function parseBilingualText(rawAr: FormDataEntryValue | null, rawEn: FormDataEntryValue | null): Tri<Bilingual> {
  const ar = str(rawAr);
  const en = str(rawEn);
  if (ar === null && en === null) return undefined;
  const a = (ar ?? "").trim();
  const e = (en ?? "").trim();
  if (a === "" && e === "") return null;
  if (a.length > TEXT_MAX || e.length > TEXT_MAX) throw new InvalidField();
  return { ar: a, en: e };
}

// Textarea → list: split on newlines, trim, drop blanks, bound count + item length.
function parseListLines(s: string): string[] {
  const items = s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (items.length > LIST_MAX_ITEMS) throw new InvalidField();
  if (items.some((line) => line.length > LIST_ITEM_MAX)) throw new InvalidField();
  return items;
}

function parseBilingualList(rawAr: FormDataEntryValue | null, rawEn: FormDataEntryValue | null): Tri<BilingualList> {
  const ar = str(rawAr);
  const en = str(rawEn);
  if (ar === null && en === null) return undefined;
  const arList = parseListLines(ar ?? "");
  const enList = parseListLines(en ?? "");
  if (arList.length === 0 && enList.length === 0) return null;
  return { ar: arList, en: enList };
}

/**
 * Parse + validate the service-information fields from a FormData submission. Returns the
 * tri-state fields, or { ok:false } (mapped to INVALID_INPUT by the caller) on any malformed
 * value or a broken min/max invariant.
 */
export function parseServiceInfoFields(formData: FormData): ServiceInfoParseResult {
  try {
    const durationMinutes = parseIntField(formData.get("durationMinutes"), DURATION_MAX_MINUTES);
    const minBookingSeats = parseIntField(formData.get("minBookingSeats"), SEAT_MAX);
    const maxBookingSeats = parseIntField(formData.get("maxBookingSeats"), SEAT_MAX);

    // Invariant: when both are concrete values, max must be >= min. (min>=1 is enforced above.)
    if (typeof minBookingSeats === "number" && typeof maxBookingSeats === "number" && maxBookingSeats < minBookingSeats) {
      return { ok: false };
    }

    const startInstructions = parseBilingualText(formData.get("startInstructionsAr"), formData.get("startInstructionsEn"));
    const inclusions = parseBilingualList(formData.get("inclusionsAr"), formData.get("inclusionsEn"));
    const exclusions = parseBilingualList(formData.get("exclusionsAr"), formData.get("exclusionsEn"));
    const customerRequirements = parseBilingualList(formData.get("requirementsAr"), formData.get("requirementsEn"));

    return {
      ok: true,
      fields: { durationMinutes, startInstructions, inclusions, exclusions, customerRequirements, minBookingSeats, maxBookingSeats },
    };
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false };
    throw error;
  }
}

// A concrete (defined) value → its Prisma write value; null → Prisma.DbNull (clear the column);
// undefined is filtered out by the callers below so the column stays unchanged.
function jsonWrite(v: object | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (v === undefined) return undefined;
  if (v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

// A precise write fragment — only the seven service-info columns, all optional. Narrow (not
// ServiceUncheckedCreateInput) so callers can safely spread it after other Service fields
// without TypeScript warning about overwriting providerId/name/serviceType.
type JsonWrite = Prisma.InputJsonValue | typeof Prisma.DbNull;
export type ServiceInfoWriteData = {
  durationMinutes?: number | null;
  minBookingSeats?: number | null;
  maxBookingSeats?: number | null;
  startInstructions?: JsonWrite;
  inclusions?: JsonWrite;
  exclusions?: JsonWrite;
  customerRequirements?: JsonWrite;
};

/** Build the write fragment — only concrete (set) or cleared (null) fields are included;
 *  `undefined` fields are omitted, so on UPDATE the column is left unchanged. */
export function serviceInfoCreateData(f: ServiceInfoFields): ServiceInfoWriteData {
  const data: ServiceInfoWriteData = {};
  if (f.durationMinutes !== undefined) data.durationMinutes = f.durationMinutes;
  if (f.minBookingSeats !== undefined) data.minBookingSeats = f.minBookingSeats;
  if (f.maxBookingSeats !== undefined) data.maxBookingSeats = f.maxBookingSeats;
  const si = jsonWrite(f.startInstructions);
  if (si !== undefined) data.startInstructions = si;
  const inc = jsonWrite(f.inclusions);
  if (inc !== undefined) data.inclusions = inc;
  const exc = jsonWrite(f.exclusions);
  if (exc !== undefined) data.exclusions = exc;
  const req = jsonWrite(f.customerRequirements);
  if (req !== undefined) data.customerRequirements = req;
  return data;
}

/** Same fragment for UPDATE (undefined = unchanged). */
export function serviceInfoUpdateData(f: ServiceInfoFields): ServiceInfoWriteData {
  return serviceInfoCreateData(f);
}

// ── Read side (fail-closed parsing of the untyped Json columns) ───────────────────────

function asBilingual(v: unknown): Bilingual | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ar = typeof o.ar === "string" ? o.ar : "";
  const en = typeof o.en === "string" ? o.en : "";
  return ar.trim() === "" && en.trim() === "" ? null : { ar, en };
}

function asBilingualList(v: unknown): BilingualList | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ar = Array.isArray(o.ar) ? o.ar.filter((x): x is string => typeof x === "string") : [];
  const en = Array.isArray(o.en) ? o.en.filter((x): x is string => typeof x === "string") : [];
  return ar.length === 0 && en.length === 0 ? null : { ar, en };
}

export type ServiceInfoRaw = {
  durationMinutes: number | null;
  startInstructions: Bilingual | null;
  inclusions: BilingualList | null;
  exclusions: BilingualList | null;
  customerRequirements: BilingualList | null;
  minBookingSeats: number | null;
  maxBookingSeats: number | null;
};

/** Read the raw (bilingual) service-info off a Service row, fail-closed. Used by the edit
 *  form (both-language prefill) and as the source for the localized customer DTO. */
export function readServiceInfo(s: {
  durationMinutes: number | null;
  startInstructions: unknown;
  inclusions: unknown;
  exclusions: unknown;
  customerRequirements: unknown;
  minBookingSeats: number | null;
  maxBookingSeats: number | null;
}): ServiceInfoRaw {
  return {
    durationMinutes: s.durationMinutes ?? null,
    startInstructions: asBilingual(s.startInstructions),
    inclusions: asBilingualList(s.inclusions),
    exclusions: asBilingualList(s.exclusions),
    customerRequirements: asBilingualList(s.customerRequirements),
    minBookingSeats: s.minBookingSeats ?? null,
    maxBookingSeats: s.maxBookingSeats ?? null,
  };
}

// describeDuration + DurationDescriptor live in the PURE ./duration module (no server-only),
// so a client component could render a duration too; re-exported here for existing callers.
export { describeDuration, type DurationDescriptor } from "./duration";

// Service content is bilingual (ar/en) only; non-Arabic UI locales fall back to English.
function pick(b: Bilingual, locale: string): string {
  const isAr = locale.toLowerCase().startsWith("ar");
  const primary = isAr ? b.ar : b.en;
  const fallback = isAr ? b.en : b.ar;
  return (primary.trim() !== "" ? primary : fallback).trim();
}

export type ServiceInfoLocalized = {
  durationMinutes: number | null;
  startInstructions: string | null;
  inclusions: string[];
  exclusions: string[];
  customerRequirements: string[];
  minBookingSeats: number | null;
  maxBookingSeats: number | null;
};

/** Localize service-info for a customer/preview view. Empty concepts collapse to null / [] so
 *  the UI renders NOTHING for them (no "Not specified" placeholders). */
export function localizeServiceInfo(raw: ServiceInfoRaw, locale: string): ServiceInfoLocalized {
  const localizeText = (b: Bilingual | null): string | null => {
    if (!b) return null;
    const v = pick(b, locale);
    return v === "" ? null : v;
  };
  const localizeList = (b: BilingualList | null): string[] => {
    if (!b) return [];
    const isAr = locale.toLowerCase().startsWith("ar");
    const primary = isAr ? b.ar : b.en;
    const fallback = isAr ? b.en : b.ar;
    return primary.length > 0 ? primary : fallback;
  };
  return {
    durationMinutes: raw.durationMinutes,
    startInstructions: localizeText(raw.startInstructions),
    inclusions: localizeList(raw.inclusions),
    exclusions: localizeList(raw.exclusions),
    customerRequirements: localizeList(raw.customerRequirements),
    minBookingSeats: raw.minBookingSeats,
    maxBookingSeats: raw.maxBookingSeats,
  };
}
