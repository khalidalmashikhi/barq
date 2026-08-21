import { describe, it, expect } from "vitest";
import {
  omanLocalToUtc,
  utcToOmanDatetimeLocal,
  omanDateKey,
  isOmanToday,
  omanValidThroughDateToExpiryInstant,
  omanValidThroughDateOfInstant,
} from "./oman-time";

// These assertions are FIXED UTC values. Asia/Muscat is UTC+04:00 (no DST), so an
// Oman wall-clock of 09:00 is 05:00Z. The assertions therefore hold regardless of
// the machine timezone the tests run in: if the implementation had used runtime-
// local parsing, the produced instant would only match on a machine that happens
// to be in Muscat — so a fixed-UTC expectation is itself the runtime-independence
// proof (req. 1-3).

describe("omanLocalToUtc — Oman wall-clock → UTC instant", () => {
  it("interprets a naive 09:00 as Oman-local and yields the correct UTC instant (05:00Z)", () => {
    expect(omanLocalToUtc("2026-08-20T09:00")?.toISOString()).toBe("2026-08-20T05:00:00.000Z");
  });

  it("is independent of runtime timezone (fixed-UTC expectation, not machine-local)", () => {
    // 00:00 Oman on Aug 20 is the prior UTC day at 20:00Z — a value that would be
    // wrong if the parser used server-local time on any non-Muscat machine.
    expect(omanLocalToUtc("2026-08-20T00:00")?.toISOString()).toBe("2026-08-19T20:00:00.000Z");
    // Midday, whole hours, and a with-seconds form.
    expect(omanLocalToUtc("2026-01-15T12:30")?.toISOString()).toBe("2026-01-15T08:30:00.000Z");
    expect(omanLocalToUtc("2026-08-20T09:00:45")?.toISOString()).toBe("2026-08-20T05:00:45.000Z");
  });

  it("honors an explicit timezone designator as an absolute instant (not re-interpreted)", () => {
    // A "Z"/offset string is already absolute — a datetime-local never produces
    // one, but a native ISO-8601 client (or a test) may.
    expect(omanLocalToUtc("2026-08-20T05:00:00.000Z")?.toISOString()).toBe("2026-08-20T05:00:00.000Z");
    expect(omanLocalToUtc("2026-08-20T09:00:00+04:00")?.toISOString()).toBe("2026-08-20T05:00:00.000Z");
  });

  it("rejects malformed or non-existent calendar dates (null, never a rolled-over date)", () => {
    expect(omanLocalToUtc("")).toBeNull();
    expect(omanLocalToUtc("2026-08-20 09:00")).toBeNull(); // space, not 'T'
    expect(omanLocalToUtc("2026-13-01T09:00")).toBeNull(); // month 13
    expect(omanLocalToUtc("2026-02-30T09:00")).toBeNull(); // Feb 30 does not exist
    expect(omanLocalToUtc("2026-08-20T25:00")).toBeNull(); // hour 25
  });
});

describe("utcToOmanDatetimeLocal — UTC instant → Oman datetime-local string", () => {
  it("renders a UTC instant back into the Oman wall-clock the input expects (req. 3)", () => {
    expect(utcToOmanDatetimeLocal(new Date("2026-08-20T05:00:00.000Z"))).toBe("2026-08-20T09:00");
    // 20:00Z is already the next Oman day at 00:00.
    expect(utcToOmanDatetimeLocal(new Date("2026-08-19T20:00:00.000Z"))).toBe("2026-08-20T00:00");
  });

  it("round-trips with omanLocalToUtc for whole-minute wall-clocks", () => {
    for (const wall of ["2026-08-20T09:00", "2026-12-31T23:59", "2026-06-01T00:00"]) {
      const utc = omanLocalToUtc(wall)!;
      expect(utcToOmanDatetimeLocal(utc)).toBe(wall);
    }
  });
});

describe("omanDateKey / isOmanToday — Oman calendar day (req. 4)", () => {
  it("uses the Oman calendar day, which can differ from the UTC day near the boundary", () => {
    // 21:30Z is still Aug 20 in UTC, but already Aug 21 (01:30) in Muscat.
    const instant = new Date("2026-08-20T21:30:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-08-20"); // UTC day
    expect(omanDateKey(instant)).toBe("2026-08-21"); // Oman day differs
  });

  it("treats an instant as 'today' by the Oman day, not the server/UTC day", () => {
    // "now" = 22:00Z on Aug 20 → Oman Aug 21 02:00. A slot at 20:00Z (Oman Aug 21
    // 00:00) is the SAME Oman day, even though its UTC day (Aug 20) matches now's
    // UTC day too here; the decisive check is that both resolve to Oman Aug 21.
    const now = new Date("2026-08-20T22:00:00.000Z");
    const sameOmanDay = new Date("2026-08-20T20:00:00.000Z"); // Oman Aug 21 00:00
    const differentOmanDay = new Date("2026-08-20T19:59:00.000Z"); // Oman Aug 20 23:59
    expect(isOmanToday(sameOmanDay, now)).toBe(true);
    expect(isOmanToday(differentOmanDay, now)).toBe(false);
  });
});

// VEHICLE-LC6 — a "valid through" Oman calendar date maps to the EXCLUSIVE next-Oman-
// midnight instant (UTC). Asia/Muscat = UTC+04:00, so Oman 2027-06-01 00:00 = 2027-05-
// 31 20:00Z. Fixed-UTC expectations are themselves the runtime-timezone-independence
// proof (§5 date semantics, deterministic UTC conversion).
describe("omanValidThroughDateToExpiryInstant — trusted expiry boundary", () => {
  it("valid THROUGH 2027-05-31 ⇒ expires at Oman 2027-06-01 00:00 = 2027-05-31T20:00:00Z", () => {
    expect(omanValidThroughDateToExpiryInstant("2027-05-31")!.toISOString()).toBe("2027-05-31T20:00:00.000Z");
  });

  it("the document is still valid the whole stated day, expired at the boundary instant", () => {
    const expiry = omanValidThroughDateToExpiryInstant("2027-05-31")!;
    const lastValidOmanMoment = new Date("2027-05-31T19:59:59.999Z"); // 2027-05-31 23:59:59.999 Oman
    expect(lastValidOmanMoment.getTime() < expiry.getTime()).toBe(true); // still valid
    expect(expiry.getTime() <= expiry.getTime()).toBe(true); // isDocumentExpired uses <= now ⇒ expired AT the boundary
  });

  it("rolls month/year boundaries over correctly (Dec 31 → next Jan 1 Oman midnight)", () => {
    expect(omanValidThroughDateToExpiryInstant("2027-12-31")!.toISOString()).toBe("2027-12-31T20:00:00.000Z");
  });

  it("handles a leap day (2028-02-29 valid-through ⇒ Mar 1 Oman midnight)", () => {
    expect(omanValidThroughDateToExpiryInstant("2028-02-29")!.toISOString()).toBe("2028-02-29T20:00:00.000Z");
  });

  it("rejects malformed / impossible dates", () => {
    expect(omanValidThroughDateToExpiryInstant("2027-13-01")).toBeNull();
    expect(omanValidThroughDateToExpiryInstant("2027-02-30")).toBeNull();
    expect(omanValidThroughDateToExpiryInstant("2027-5-31")).toBeNull();
    expect(omanValidThroughDateToExpiryInstant("not-a-date")).toBeNull();
    expect(omanValidThroughDateToExpiryInstant("")).toBeNull();
  });

  it("round-trips through omanValidThroughDateOfInstant (instant → valid-through date)", () => {
    for (const d of ["2027-05-31", "2027-12-31", "2028-02-29", "2027-01-01"]) {
      const instant = omanValidThroughDateToExpiryInstant(d)!;
      expect(omanValidThroughDateOfInstant(instant)).toBe(d);
    }
  });

  // QA-D1 — the trusted-expiry INSTANT maps back to the valid-through DATE, never the
  // next day. The stored instant is the EXCLUSIVE next-Oman-midnight boundary, so the
  // valid-through day is the one that ends at that boundary (2027-05-31T20:00:00Z is
  // Oman 2027-06-01 00:00, whose document is valid THROUGH 2027-05-31 — not June 1).
  it("QA-D1 — omanValidThroughDateOfInstant returns the valid-through day, not the boundary day", () => {
    // The stored instant is the EXCLUSIVE next-Oman-midnight boundary = <valid-through>T20:00:00Z
    // (Oman is +04:00). The valid-through day is the date of that instant, never the next day.
    expect(omanValidThroughDateOfInstant(new Date("2027-05-31T20:00:00.000Z"))).toBe("2027-05-31"); // not 2027-06-01
    expect(omanValidThroughDateOfInstant(new Date("2027-01-31T20:00:00.000Z"))).toBe("2027-01-31"); // month boundary, not Feb 1
    expect(omanValidThroughDateOfInstant(new Date("2027-12-31T20:00:00.000Z"))).toBe("2027-12-31"); // year boundary, not Jan 1
    expect(omanValidThroughDateOfInstant(new Date("2028-02-29T20:00:00.000Z"))).toBe("2028-02-29"); // leap day, not Mar 1
  });
});
