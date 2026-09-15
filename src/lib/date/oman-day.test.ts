import { describe, it, expect } from "vitest";
import {
  parseOmanDateKey,
  omanDateKeyFromDbDate,
  omanDayWindow,
  startMinutesToHHmm,
  omanPickupInstant,
  isOmanPastDateKey,
} from "./oman-time";

// Phase 3C Slice C2a — canonical Oman calendar-day utilities. Every assertion here is
// runtime-timezone-independent (the helpers never read the server-local zone).

describe("parseOmanDateKey", () => {
  it("accepts real dates incl. leap day", () => {
    expect(parseOmanDateKey("2026-08-20")).toBe("2026-08-20");
    expect(parseOmanDateKey("  2024-02-29  ")).toBe("2024-02-29"); // 2024 is a leap year
  });
  it("rejects non-leap Feb 29, rollover, bad month/day, loose format, non-strings", () => {
    expect(parseOmanDateKey("2026-02-29")).toBeNull(); // 2026 not a leap year
    expect(parseOmanDateKey("2026-02-30")).toBeNull();
    expect(parseOmanDateKey("2026-13-01")).toBeNull();
    expect(parseOmanDateKey("2026-00-10")).toBeNull();
    expect(parseOmanDateKey("2026-8-20")).toBeNull(); // not zero-padded
    expect(parseOmanDateKey("2026/08/20")).toBeNull();
    expect(parseOmanDateKey("")).toBeNull();
    expect(parseOmanDateKey(42 as unknown as string)).toBeNull();
    expect(parseOmanDateKey(null as unknown as string)).toBeNull();
  });
});

describe("omanDateKeyFromDbDate (no-shift @db.Date round-trip)", () => {
  it("reads the calendar date from a UTC-midnight value without applying the Oman offset", () => {
    // Prisma returns @db.Date as UTC midnight; the key must be that exact Y-M-D.
    expect(omanDateKeyFromDbDate(new Date("2026-08-20T00:00:00.000Z"))).toBe("2026-08-20");
    expect(omanDateKeyFromDbDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
    expect(omanDateKeyFromDbDate(new Date("2026-12-31T00:00:00.000Z"))).toBe("2026-12-31");
  });
  it("throws on a non-midnight instant (a calendar date was expected, not an instant)", () => {
    expect(() => omanDateKeyFromDbDate(new Date("2026-08-20T09:00:00.000Z"))).toThrow();
  });
  it("throws on an invalid Date", () => {
    expect(() => omanDateKeyFromDbDate(new Date("nope"))).toThrow();
  });
});

describe("omanDayWindow (half-open UTC Oman-day)", () => {
  it("returns [thisOmanMidnight, nextOmanMidnight) — a 24h span for Oman (UTC+4)", () => {
    const w = omanDayWindow("2026-08-20");
    expect(w).not.toBeNull();
    // Oman midnight 2026-08-20 00:00 +04:00 = 2026-08-19 20:00Z; next = 2026-08-20 20:00Z.
    expect(w!.start.toISOString()).toBe("2026-08-19T20:00:00.000Z");
    expect(w!.end.toISOString()).toBe("2026-08-20T20:00:00.000Z");
    expect(w!.end.getTime() - w!.start.getTime()).toBe(86_400_000);
  });
  it("is null for an invalid date key", () => {
    expect(omanDayWindow("2026-02-30")).toBeNull();
  });
});

describe("startMinutesToHHmm", () => {
  it("formats boundary + interior minutes", () => {
    expect(startMinutesToHHmm(0)).toBe("00:00");
    expect(startMinutesToHHmm(1)).toBe("00:01");
    expect(startMinutesToHHmm(719)).toBe("11:59");
    expect(startMinutesToHHmm(540)).toBe("09:00");
    expect(startMinutesToHHmm(1439)).toBe("23:59");
  });
  it("fails explicitly (null) for out-of-range / non-integer", () => {
    expect(startMinutesToHHmm(-1)).toBeNull();
    expect(startMinutesToHHmm(1440)).toBeNull();
    expect(startMinutesToHHmm(9.5)).toBeNull();
    expect(startMinutesToHHmm(NaN)).toBeNull();
  });
});

describe("omanPickupInstant", () => {
  it("combines Oman date + minutes into the correct UTC instant", () => {
    // 2026-08-20 09:00 Oman (+04:00) = 2026-08-20 05:00Z.
    expect(omanPickupInstant("2026-08-20", 540)!.toISOString()).toBe("2026-08-20T05:00:00.000Z");
    expect(omanPickupInstant("2026-08-20", 0)!.toISOString()).toBe("2026-08-19T20:00:00.000Z");
  });
  it("null on invalid inputs", () => {
    expect(omanPickupInstant("2026-02-30", 540)).toBeNull();
    expect(omanPickupInstant("2026-08-20", 1440)).toBeNull();
  });
});

describe("isOmanPastDateKey (Oman calendar boundary, injectable now)", () => {
  it("today is NOT past; yesterday is; tomorrow is not", () => {
    const now = new Date("2026-08-20T10:00:00.000Z"); // Oman 14:00 on 2026-08-20
    expect(isOmanPastDateKey("2026-08-20", now)).toBe(false);
    expect(isOmanPastDateKey("2026-08-19", now)).toBe(true);
    expect(isOmanPastDateKey("2026-08-21", now)).toBe(false);
  });
  it("uses the OMAN date near the UTC/Oman day boundary (not the server/UTC date)", () => {
    // 2026-08-20 21:00Z is already 2026-08-21 01:00 in Muscat → 2026-08-20 is past.
    const now = new Date("2026-08-20T21:00:00.000Z");
    expect(isOmanPastDateKey("2026-08-20", now)).toBe(true);
    expect(isOmanPastDateKey("2026-08-21", now)).toBe(false);
  });
  it("throws on an invalid date key", () => {
    expect(() => isOmanPastDateKey("2026-02-30")).toThrow();
  });
});
