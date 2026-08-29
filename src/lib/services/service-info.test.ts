import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

// service-info.ts is `import "server-only"`; the marker throws under Vitest's
// non-RSC module loader, so neutralize it exactly as the booking tests do.
vi.mock("server-only", () => ({}));
import {
  parseServiceInfoFields,
  serviceInfoCreateData,
  serviceInfoUpdateData,
  readServiceInfo,
  localizeServiceInfo,
  describeDuration,
  DURATION_MAX_MINUTES,
  SEAT_MAX,
  TEXT_MAX,
  LIST_MAX_ITEMS,
  LIST_ITEM_MAX,
  type ServiceInfoFields,
} from "./service-info";

// Build a FormData from a flat record. A key whose value is undefined is NOT
// appended — that models the browser omitting an absent field, which the parser
// must read back as `undefined` (leave-unchanged), distinct from an empty string.
function form(entries: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

function parseOk(entries: Record<string, string | undefined>): ServiceInfoFields {
  const result = parseServiceInfoFields(form(entries));
  if (!result.ok) throw new Error("expected parse to succeed");
  return result.fields;
}

describe("parseServiceInfoFields — tri-state per field", () => {
  it("treats every absent key as `undefined` (leave unchanged)", () => {
    const f = parseOk({});
    expect(f.durationMinutes).toBeUndefined();
    expect(f.minBookingSeats).toBeUndefined();
    expect(f.maxBookingSeats).toBeUndefined();
    expect(f.startInstructions).toBeUndefined();
    expect(f.inclusions).toBeUndefined();
    expect(f.exclusions).toBeUndefined();
    expect(f.customerRequirements).toBeUndefined();
  });

  it("treats a present-but-empty value as `null` (clear the column)", () => {
    const f = parseOk({
      durationMinutes: "",
      minBookingSeats: "  ",
      startInstructionsAr: "",
      startInstructionsEn: "   ",
      inclusionsAr: "",
      inclusionsEn: "\n\n",
    });
    expect(f.durationMinutes).toBeNull();
    expect(f.minBookingSeats).toBeNull();
    expect(f.startInstructions).toBeNull();
    expect(f.inclusions).toBeNull();
  });

  it("parses concrete integers and bilingual text", () => {
    const f = parseOk({
      durationMinutes: "90",
      minBookingSeats: "2",
      maxBookingSeats: "6",
      startInstructionsAr: " نقطة الانطلاق ",
      startInstructionsEn: "  Meet at the marina ",
    });
    expect(f.durationMinutes).toBe(90);
    expect(f.minBookingSeats).toBe(2);
    expect(f.maxBookingSeats).toBe(6);
    expect(f.startInstructions).toEqual({ ar: "نقطة الانطلاق", en: "Meet at the marina" });
  });

  it("is bilingual-partial tolerant: one language filled, the other blank", () => {
    const f = parseOk({ startInstructionsEn: "English only", startInstructionsAr: "" });
    expect(f.startInstructions).toEqual({ ar: "", en: "English only" });
  });
});

describe("parseServiceInfoFields — list handling", () => {
  it("splits a textarea into trimmed lines and drops blanks", () => {
    const f = parseOk({
      inclusionsEn: " Water \n\n Guide \n   \n Snacks ",
      inclusionsAr: "ماء\nمرشد",
    });
    expect(f.inclusions).toEqual({ ar: ["ماء", "مرشد"], en: ["Water", "Guide", "Snacks"] });
  });

  it("rejects a list with more than LIST_MAX_ITEMS items", () => {
    const tooMany = Array.from({ length: LIST_MAX_ITEMS + 1 }, (_, i) => `item ${i}`).join("\n");
    expect(parseServiceInfoFields(form({ inclusionsEn: tooMany })).ok).toBe(false);
  });

  it("accepts exactly LIST_MAX_ITEMS items", () => {
    const exactly = Array.from({ length: LIST_MAX_ITEMS }, (_, i) => `item ${i}`).join("\n");
    expect(parseServiceInfoFields(form({ inclusionsEn: exactly })).ok).toBe(true);
  });

  it("rejects a single list item longer than LIST_ITEM_MAX", () => {
    expect(parseServiceInfoFields(form({ exclusionsEn: "x".repeat(LIST_ITEM_MAX + 1) })).ok).toBe(false);
  });
});

describe("parseServiceInfoFields — numeric bounds", () => {
  it.each(["0", "-1", "1.5", "abc", " 5 6 ", "1e3"])("rejects a non-positive-integer duration %j", (bad) => {
    expect(parseServiceInfoFields(form({ durationMinutes: bad })).ok).toBe(false);
  });

  it("rejects a duration over the anti-abuse ceiling", () => {
    expect(parseServiceInfoFields(form({ durationMinutes: String(DURATION_MAX_MINUTES + 1) })).ok).toBe(false);
    expect(parseServiceInfoFields(form({ durationMinutes: String(DURATION_MAX_MINUTES) })).ok).toBe(true);
  });

  it("rejects a seat count over the ceiling", () => {
    expect(parseServiceInfoFields(form({ minBookingSeats: String(SEAT_MAX + 1) })).ok).toBe(false);
    expect(parseServiceInfoFields(form({ minBookingSeats: String(SEAT_MAX) })).ok).toBe(true);
  });

  it("rejects text longer than TEXT_MAX", () => {
    expect(parseServiceInfoFields(form({ startInstructionsEn: "y".repeat(TEXT_MAX + 1) })).ok).toBe(false);
  });
});

describe("parseServiceInfoFields — min/max seat invariant", () => {
  it("rejects max < min", () => {
    expect(parseServiceInfoFields(form({ minBookingSeats: "6", maxBookingSeats: "2" })).ok).toBe(false);
  });

  it("accepts max === min", () => {
    const f = parseOk({ minBookingSeats: "4", maxBookingSeats: "4" });
    expect(f.minBookingSeats).toBe(4);
    expect(f.maxBookingSeats).toBe(4);
  });

  it("accepts an open-ended bound (only min, or only max)", () => {
    expect(parseOk({ minBookingSeats: "2" }).maxBookingSeats).toBeUndefined();
    expect(parseOk({ maxBookingSeats: "8" }).minBookingSeats).toBeUndefined();
  });
});

describe("serviceInfoCreateData / serviceInfoUpdateData — write fragment", () => {
  it("omits undefined fields entirely (column left unchanged / unset)", () => {
    const data = serviceInfoCreateData(parseOk({}));
    expect(data).toEqual({});
    expect("durationMinutes" in data).toBe(false);
    expect("startInstructions" in data).toBe(false);
  });

  it("maps present-empty to Prisma.DbNull (clear) for JSON columns and null for scalars", () => {
    const data = serviceInfoUpdateData(parseOk({ durationMinutes: "", startInstructionsEn: "" }));
    expect(data.durationMinutes).toBeNull();
    expect(data.startInstructions).toBe(Prisma.DbNull);
  });

  it("passes concrete values straight through", () => {
    const data = serviceInfoCreateData(parseOk({ durationMinutes: "45", inclusionsEn: "Water" }));
    expect(data.durationMinutes).toBe(45);
    expect(data.inclusions).toEqual({ ar: [], en: ["Water"] });
  });
});

describe("readServiceInfo — fail-closed read of untyped Json columns", () => {
  const empty = {
    durationMinutes: null,
    startInstructions: null,
    inclusions: null,
    exclusions: null,
    customerRequirements: null,
    minBookingSeats: null,
    maxBookingSeats: null,
  };

  it("returns all-empty for a legacy row with nothing authored", () => {
    expect(readServiceInfo(empty)).toEqual({
      durationMinutes: null,
      startInstructions: null,
      inclusions: null,
      exclusions: null,
      customerRequirements: null,
      minBookingSeats: null,
      maxBookingSeats: null,
    });
  });

  it("coerces malformed JSON shapes to null rather than trusting them", () => {
    const raw = readServiceInfo({
      ...empty,
      startInstructions: "a bare string, not {ar,en}",
      inclusions: ["a", "bare", "array"],
      exclusions: { ar: [1, 2, "keep"], en: "not-an-array" },
    });
    expect(raw.startInstructions).toBeNull();
    expect(raw.inclusions).toBeNull();
    // Non-string members are filtered; a bare string en becomes [].
    expect(raw.exclusions).toEqual({ ar: ["keep"], en: [] });
  });
});

describe("localizeServiceInfo — customer/preview projection", () => {
  const raw = readServiceInfo({
    durationMinutes: 120,
    startInstructions: { ar: "الرصيف", en: "The dock" },
    inclusions: { ar: ["ماء"], en: ["Water", "Guide"] },
    exclusions: { ar: [], en: ["Tips"] },
    customerRequirements: null,
    minBookingSeats: 1,
    maxBookingSeats: 4,
  });

  it("picks Arabic for an ar locale", () => {
    const loc = localizeServiceInfo(raw, "ar");
    expect(loc.startInstructions).toBe("الرصيف");
    expect(loc.inclusions).toEqual(["ماء"]);
  });

  it("picks English for a non-ar locale and falls back when a language is empty", () => {
    const loc = localizeServiceInfo(raw, "en");
    expect(loc.startInstructions).toBe("The dock");
    expect(loc.inclusions).toEqual(["Water", "Guide"]);
    // ar exclusions are empty → fall back to en.
    expect(localizeServiceInfo(raw, "ar").exclusions).toEqual(["Tips"]);
  });

  it("collapses absent concepts to null / [] so the UI renders nothing", () => {
    const loc = localizeServiceInfo(raw, "en");
    expect(loc.customerRequirements).toEqual([]);
    const bare = localizeServiceInfo(
      readServiceInfo({
        durationMinutes: null,
        startInstructions: null,
        inclusions: null,
        exclusions: null,
        customerRequirements: null,
        minBookingSeats: null,
        maxBookingSeats: null,
      }),
      "en"
    );
    expect(bare.startInstructions).toBeNull();
    expect(bare.inclusions).toEqual([]);
    expect(bare.durationMinutes).toBeNull();
  });
});

describe("describeDuration — machine minutes → i18n descriptor", () => {
  it("uses whole days when divisible by 1440", () => {
    expect(describeDuration(1440)).toEqual({ key: "durationDays", count: 1 });
    expect(describeDuration(2880)).toEqual({ key: "durationDays", count: 2 });
  });

  it("uses minutes under an hour", () => {
    expect(describeDuration(45)).toEqual({ key: "durationMinutes", count: 45 });
  });

  it("uses whole hours when divisible by 60 (and not a whole day)", () => {
    expect(describeDuration(120)).toEqual({ key: "durationHours", count: 2 });
  });

  it("uses hours + minutes otherwise", () => {
    expect(describeDuration(90)).toEqual({ key: "durationHoursMinutes", hours: 1, minutes: 30 });
  });
});
