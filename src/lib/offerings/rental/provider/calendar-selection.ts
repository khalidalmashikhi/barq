// Phase 3C Slice C2d-R1 Checkpoint B — PURE, timezone-free helpers for the provider availability
// calendar's selection + windowing. Oman calendar dates are `YYYY-MM-DD` keys; all math is plain
// UTC-midnight day arithmetic (never browser-local Date parsing), matching the C2a Oman-date
// contract. No React, no I/O — unit-testable in isolation. OPEN here is provider CONFIGURATION state,
// never reservation-aware customer availability.

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const MS_PER_DAY = 86_400_000;

function keyToUtcMs(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject impossible dates (e.g. 2030-02-31 rolling over).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** Inclusive contiguous Oman day keys between two keys (order-independent); [] on an invalid key. */
export function dateKeysInInclusiveRange(a: string, b: string): string[] {
  const aMs = keyToUtcMs(a);
  const bMs = keyToUtcMs(b);
  if (aMs === null || bMs === null) return [];
  const start = Math.min(aMs, bMs);
  const end = Math.max(aMs, bMs);
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    const dt = new Date(ms);
    out.push(keyOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }
  return out;
}

/** A key strictly before Oman "today" (past dates are never configurable). String compare is exact for YYYY-MM-DD. */
export function isPastKey(key: string, todayKey: string): boolean {
  return key < todayKey;
}

/** Whether a key is a configurable date: today-or-later AND within the forward window (exclusive end). */
export function isConfigurableKey(key: string, todayKey: string, windowDays: number): boolean {
  const k = keyToUtcMs(key);
  const t = keyToUtcMs(todayKey);
  if (k === null || t === null) return false;
  const endExclusive = t + windowDays * MS_PER_DAY;
  return k >= t && k < endExclusive;
}

/** All day keys of a calendar month (m0 is 0-based). */
export function monthDayKeys(y: number, m0: number): string[] {
  const days = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => keyOf(y, m0, i + 1));
}

/** Toggle one key in a selection set, returning a NEW set (immutable update for React state). */
export function toggleKey(selection: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selection);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** One configured-day record as the calendar consumes it (subset of the read model's day DTO). */
export type CalendarDayRecord = { state: "OPEN" | "BLOCKED"; dailyAmount: string; priceSource: "BASE" | "OVERRIDE" };

/** The fully-derived render state of one calendar cell — the single source the component renders from. */
export type RentalCalendarCell = {
  dateKey: string;
  /** OPEN / BLOCKED when configured, else NONE (no day row). CONFIGURATION state, not availability. */
  state: "OPEN" | "BLOCKED" | "NONE";
  /** Resolved daily price: the day override when present, else the offering base. Never computed. */
  priceAmount: string;
  priceSource: "BASE" | "OVERRIDE";
  /** Today-or-later AND within the forward window → the provider may select/mutate it. */
  configurable: boolean;
  past: boolean;
  selected: boolean;
};

/**
 * Derive a calendar cell's render state purely (no React) so the component's per-cell logic is unit-
 * tested directly. Override price wins over base; a cell with no day row is NONE at the base price.
 */
export function deriveRentalCalendarCell(
  dateKey: string,
  opts: { day?: CalendarDayRecord; baseDailyAmount: string; todayKey: string; windowDays: number; selected: boolean },
): RentalCalendarCell {
  const { day, baseDailyAmount, todayKey, windowDays, selected } = opts;
  return {
    dateKey,
    state: day ? day.state : "NONE",
    priceAmount: day ? day.dailyAmount : baseDailyAmount,
    priceSource: day && day.priceSource === "OVERRIDE" ? "OVERRIDE" : "BASE",
    configurable: isConfigurableKey(dateKey, todayKey, windowDays),
    past: isPastKey(dateKey, todayKey),
    selected,
  };
}
