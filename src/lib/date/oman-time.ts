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
