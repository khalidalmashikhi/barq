import { OMAN_TIME_ZONE } from "./oman-timezone";

// Oman business-timezone conversions (AVAIL-TZ-FIX).
//
// BARQ operates in Oman; the CANONICAL business timezone is Asia/Muscat. The DB
// keeps UTC (`timestamptz`) unchanged — this module is the single, testable seam
// that converts between a naive Oman wall-clock (what a provider types into a
// `datetime-local`/`date`+`time` input, e.g. "2026-08-20T09:00") and the correct
// UTC instant, and back, plus the Oman CALENDAR DAY of an instant.
//
// WHY THIS EXISTS: `new Date("2026-08-20T09:00")` (an offset-less date-time) is
// parsed by ECMAScript in the RUNTIME's local timezone. On Vercel (UTC) that
// makes "09:00" mean 09:00Z, not Oman 09:00 (05:00Z) — a real correctness bug.
// Every function here is runtime-timezone-INDEPENDENT by construction: it passes
// `timeZone: OMAN_TIME_ZONE` to Intl and does the arithmetic with `Date.UTC`,
// never reading the process/server local zone and never hard-coding "+04:00".
//
// DST-SAFE BY SEMANTICS: Asia/Muscat has no DST today, but the wall-clock→UTC
// resolution below re-evaluates the zone offset at the candidate instant rather
// than assuming a fixed offset, so it stays correct if that ever changes.

type OmanParts = { year: string; month: string; day: string; hour: string; minute: string; second: string };

// The Oman-local calendar/clock parts of a UTC instant. Values are numeric
// strings (2-digit except the 4-digit year); `hourCycle: "h23"` guarantees
// hours are "00".."23" (avoids the "24:00" some engines emit under hour12:false).
function omanParts(instant: Date): OmanParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OMAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const pick = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

// Offset (ms) that Asia/Muscat is AHEAD of UTC at the given instant:
// omanWallClock(instant) - instant. Positive for Oman (+04:00).
function omanOffsetMsAt(instant: Date): number {
  const p = omanParts(instant);
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asIfUtc - instant.getTime();
}

const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
// A trailing "Z" or "±HH:mm"/"±HHmm" designator means the string is already an
// absolute instant, not a wall-clock needing a zone.
const HAS_TZ_DESIGNATOR = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * Interpret an availability time string and return the correct UTC instant, or
 * null if malformed.
 *
 * - A string WITHOUT a timezone designator (what an <input type="datetime-local">
 *   produces, e.g. "2026-08-20T09:00") is a naive Oman wall-clock and is
 *   interpreted as Asia/Muscat.
 * - A string WITH an explicit designator (a "Z" or "±HH:mm" offset — e.g. a
 *   native client's ISO-8601) is already absolute and is honored as-is, never
 *   re-interpreted.
 *
 * Runtime-timezone-independent in both cases: the result is the same UTC instant
 * no matter what timezone the server runs in.
 */
export function omanLocalToUtc(input: string): Date | null {
  const s = input.trim();
  if (HAS_TZ_DESIGNATOR.test(s)) {
    const absolute = new Date(s);
    return Number.isNaN(absolute.getTime()) ? null : absolute;
  }

  const m = NAIVE_RE.exec(s);
  if (!m) return null;
  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  const H = Number(m[4]);
  const Mi = Number(m[5]);
  const S = m[6] ? Number(m[6]) : 0;
  if (Mo < 1 || Mo > 12 || D < 1 || D > 31 || H > 23 || Mi > 59 || S > 59) return null;

  // Treat the components as if they were UTC to get a provisional instant, then
  // reject any date that rolled over (Feb 30 → Mar 2 ⇒ getUTCDate() !== D).
  const asIfUtc = Date.UTC(Y, Mo - 1, D, H, Mi, S);
  const probe = new Date(asIfUtc);
  if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== Mo - 1 || probe.getUTCDate() !== D) return null;

  // Resolve the real UTC instant: local = utc + offset ⇒ utc = asIfUtc - offset.
  // Re-evaluate the offset at the candidate instant once (DST-boundary safety).
  const offset = omanOffsetMsAt(probe);
  let utcMs = asIfUtc - offset;
  const refined = omanOffsetMsAt(new Date(utcMs));
  if (refined !== offset) utcMs = asIfUtc - refined;
  return new Date(utcMs);
}

/**
 * Render a UTC instant as the Oman-local "YYYY-MM-DDTHH:mm" string an
 * <input type="datetime-local"> expects (no timezone designator). The inverse of
 * omanLocalToUtc for whole-minute values.
 */
export function utcToOmanDatetimeLocal(instant: Date): string {
  const p = omanParts(instant);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * The Oman CALENDAR DAY ("YYYY-MM-DD") an instant falls on — the basis for
 * "today"/date-grouping decisions whose business meaning is Oman-local. Differs
 * from the UTC date near the day boundary (e.g. 21:30Z is already the next day
 * in Muscat).
 */
export function omanDateKey(instant: Date): string {
  const p = omanParts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/** True when the instant falls on the current Oman calendar day. */
export function isOmanToday(instant: Date, now: Date = new Date()): boolean {
  return omanDateKey(instant) === omanDateKey(now);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * VEHICLE-LC6 — the trusted-expiry BOUNDARY for a document whose validity is
 * stated as an Oman calendar DATE.
 *
 * A document "valid through 2027-05-31" stays valid for the WHOLE of that Oman
 * day and expires at the FIRST instant of the following Oman day
 * (2027-06-01 00:00 Asia/Muscat), returned as the UTC instant to store in
 * AssetDocument.expiresAt. This composes with isDocumentExpired (expiresAt <= now):
 * at 2027-05-31 23:59 Oman the document is still valid; at 2027-06-01 00:00 Oman
 * it is expired. Returns null for a malformed/impossible date (e.g. 2027-02-30).
 * Runtime-timezone-independent (delegates to omanLocalToUtc).
 */
export function omanValidThroughDateToExpiryInstant(ymd: string): Date | null {
  const m = DATE_ONLY_RE.exec(ymd.trim());
  if (!m) return null;
  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  // Reject a rolled-over/impossible date (Feb 30 → Mar 2 ⇒ getUTCDate() !== D).
  const probe = new Date(Date.UTC(Y, Mo - 1, D));
  if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== Mo - 1 || probe.getUTCDate() !== D) return null;
  // The exclusive end = the NEXT Oman calendar day at 00:00. Date.UTC rolls month /
  // year boundaries over safely (Dec 31 → Jan 1, Feb 28 → Mar 1, etc.).
  const next = new Date(Date.UTC(Y, Mo - 1, D + 1));
  const y = next.getUTCFullYear();
  const mo = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return omanLocalToUtc(`${y}-${mo}-${d}T00:00`);
}

/**
 * VEHICLE-LC6 — the inverse of {@link omanValidThroughDateToExpiryInstant}: the
 * Oman "valid through" calendar date ("YYYY-MM-DD") for a stored trusted-expiry
 * INSTANT. Because the instant is the exclusive next-Oman-midnight boundary, the
 * last valid moment is one millisecond earlier, and its Oman calendar day is the
 * valid-through date. Used to prefill the admin's date field from an existing
 * expiresAt. Round-trips with the forward helper.
 */
export function omanValidThroughDateOfInstant(expiresAtExclusive: Date): string {
  return omanDateKey(new Date(expiresAtExclusive.getTime() - 1));
}

// =============================================================================
// Phase 3C Slice C2a — canonical Oman CALENDAR-DAY utilities for vehicle daily
// offerings. Pure and runtime-timezone-independent, composing the authorities
// above (never re-deriving timezone logic or constructing dates with local
// `new Date(y, m, d)`). No I/O.
// =============================================================================

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Validate + normalize an Oman calendar date key. Accepts EXACTLY "YYYY-MM-DD",
 * rejects a rolled-over/impossible date (e.g. 2026-02-30, 2026-13-01), and returns
 * the trimmed normalized key or null. Runtime-timezone-independent (uses Date.UTC
 * only to detect rollover, never a local constructor).
 */
export function parseOmanDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const m = DATE_ONLY_RE.exec(s);
  if (!m) return null;
  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  if (Mo < 1 || Mo > 12 || D < 1 || D > 31) return null;
  const probe = new Date(Date.UTC(Y, Mo - 1, D));
  if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== Mo - 1 || probe.getUTCDate() !== D) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * The Oman calendar date key ("YYYY-MM-DD") of a Prisma `@db.Date` value. A `date`
 * column is ZONE-FREE and Prisma returns it as a JS Date at UTC-MIDNIGHT; this reads
 * the calendar date via UTC getters and NEVER applies the Oman offset (doing so would
 * conceptually shift a zone-free date). Throws on a non-Date, an invalid Date, or a
 * value that is not at UTC-midnight (which would mean an instant was passed where a
 * calendar date was expected — a contract violation worth surfacing loudly).
 */
export function omanDateKeyFromDbDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("omanDateKeyFromDbDate: expected a valid Date");
  }
  if (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    throw new RangeError("omanDateKeyFromDbDate: expected a UTC-midnight @db.Date value");
  }
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * The inverse of {@link omanDateKeyFromDbDate}: build the UTC-MIDNIGHT `Date` that a Prisma
 * `@db.Date` column stores for an Oman calendar date key ("YYYY-MM-DD"). Zone-free — the
 * offset is deliberately NOT applied, so the stored YYYY-MM-DD equals the key exactly.
 * Returns null for an invalid/malformed key (never throws on caller input).
 */
export function dbDateFromOmanDateKey(dateKey: string): Date | null {
  const key = parseOmanDateKey(dateKey);
  if (key === null) return null;
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * The half-open UTC interval [startOfOmanDay, startOfNextOmanDay) for an Oman date
 * key — the window a vehicle-conflict overlap check runs against. `start` is the
 * this-day Oman midnight and `end` is the exclusive next-Oman-midnight (reusing the
 * existing authorities), so today it is a 24h span WITHOUT any hard-coded offset.
 * Returns null for an invalid date key.
 */
export function omanDayWindow(dateKey: string): { start: Date; end: Date } | null {
  const key = parseOmanDateKey(dateKey);
  if (key === null) return null;
  const start = omanLocalToUtc(`${key}T00:00`);
  const end = omanValidThroughDateToExpiryInstant(key);
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * Format Oman-local minutes-from-midnight (a RentalStartTime/GuidedTourVehicleStartTime
 * `startTimeMinutes`) as a zero-padded "HH:mm". Accepts only integers 0–1439; any other
 * value fails explicitly with null.
 */
export function startMinutesToHHmm(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return null;
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/**
 * The absolute UTC pickup instant for an Oman calendar date + operational
 * minutes-from-midnight. Validates both inputs, then combines them as an Oman
 * wall-clock and converts via the existing omanLocalToUtc authority (never the
 * server-local zone). Returns null if either input is invalid.
 */
export function omanPickupInstant(dateKey: string, startTimeMinutes: number): Date | null {
  const key = parseOmanDateKey(dateKey);
  const hhmm = startMinutesToHHmm(startTimeMinutes);
  if (key === null || hhmm === null) return null;
  return omanLocalToUtc(`${key}T${hhmm}`);
}

/**
 * Whether an Oman date key is in the PAST relative to the current Oman calendar day
 * (today is NOT past). Compares Oman-local calendar dates, never server-local date
 * boundaries; `now` is injectable for tests. Throws on an invalid date key.
 */
export function isOmanPastDateKey(dateKey: string, now: Date = new Date()): boolean {
  const key = parseOmanDateKey(dateKey);
  if (key === null) throw new RangeError(`isOmanPastDateKey: invalid Oman date key "${dateKey}"`);
  return key < omanDateKey(now);
}
