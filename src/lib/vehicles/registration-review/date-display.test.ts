import { describe, it, expect } from "vitest";
import { formatIsoDateForDisplay, parseDisplayedDate, dateFieldSubmissionValue, DATE_INPUT_PLACEHOLDER } from "./date-display";

// Arabic-iPhone date correction: canonical ISO in storage/submission, unambiguous DD/MM/YYYY on
// screen, pure string arithmetic (no Date, no zone, no device locale) so no day ever shifts.

describe("formatIsoDateForDisplay — unambiguous day/month/year, Western digits, no reordering", () => {
  it("renders ISO as DD/MM/YYYY for every interface language (digits are universal)", () => {
    expect(formatIsoDateForDisplay("2026-06-26")).toBe("26/06/2026");
    expect(formatIsoDateForDisplay("2027-05-31")).toBe("31/05/2027");
    expect(formatIsoDateForDisplay("2019-06-01")).toBe("01/06/2019");
  });

  it("is a pure string transform: the parts come out in the same order on an RTL page (no bidi reordering can apply inside a single LTR-isolated token)", () => {
    const shown = formatIsoDateForDisplay("2026-06-26");
    expect(shown.split("/")).toEqual(["26", "06", "2026"]);
    expect(shown).not.toMatch(/[٠-٩۰-۹]/); // never Arabic-Indic digits on screen
    expect(shown).not.toMatch(/[‎‏‪-‮⁦-⁩]/); // no embedded bidi controls
  });

  it("never guesses: anything that is not canonical ISO renders empty", () => {
    for (const bad of ["26/06/2026", "2026-6-26", "", null, undefined, "2026-13-01", "Fri Jun 26 2026"]) expect(formatIsoDateForDisplay(bad)).toBe("");
  });
});

describe("parseDisplayedDate — what the provider types → canonical ISO", () => {
  it("accepts day/month/year with /, - or . and Arabic-Indic digits; accepts ISO too", () => {
    expect(parseDisplayedDate("26/06/2026")).toBe("2026-06-26");
    expect(parseDisplayedDate("26-06-2026")).toBe("2026-06-26");
    expect(parseDisplayedDate("26.06.2026")).toBe("2026-06-26");
    expect(parseDisplayedDate("٢٦/٠٦/٢٠٢٦")).toBe("2026-06-26");
    expect(parseDisplayedDate("2026-06-26")).toBe("2026-06-26");
    expect(parseDisplayedDate("1/6/2026")).toBe("2026-06-01");
  });

  it("refuses ambiguous or impossible input (two-digit year, month 13, 30 February, empty)", () => {
    for (const bad of ["26/06/26", "01/13/2026", "30/02/2027", "", "   ", null, undefined, "abc"]) expect(parseDisplayedDate(bad)).toBeNull();
  });

  it("round-trips: display → parse → display, with NO day shift (Oman is UTC+4; nothing here uses a clock)", () => {
    for (const iso of ["2026-06-26", "2026-01-01", "2026-12-31", "2024-02-29", "2026-06-30"]) {
      expect(parseDisplayedDate(formatIsoDateForDisplay(iso))).toBe(iso);
    }
    // A midnight-adjacent date is still the same calendar day — there is no Date/UTC conversion to shift it.
    expect(parseDisplayedDate("01/01/2026")).toBe("2026-01-01");
    expect(parseDisplayedDate("31/12/2026")).toBe("2026-12-31");
  });
});

describe("dateFieldSubmissionValue — what the form sends", () => {
  it("sends ISO for a valid date, the raw text for an invalid one (so the server names the field), and empty for empty", () => {
    expect(dateFieldSubmissionValue("26/06/2026")).toBe("2026-06-26");
    expect(dateFieldSubmissionValue("not a date")).toBe("not a date");
    expect(dateFieldSubmissionValue("")).toBe("");
    expect(dateFieldSubmissionValue("   ")).toBe("");
  });

  it("the placeholder is the same, locale-independent pattern", () => {
    expect(DATE_INPUT_PLACEHOLDER).toBe("DD/MM/YYYY");
  });
});
