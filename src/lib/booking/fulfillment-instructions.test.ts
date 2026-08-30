import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  parseFulfillmentInstructionsForm,
  fulfillmentInstructionsWrite,
  readFulfillmentInstructions,
  localizeFulfillmentInstructions,
  FULFILLMENT_TEXT_MAX,
} from "./fulfillment-instructions";

// BOOKING FULFILLMENT LOGISTICS — the pure parser/reader/localizer behind the provider action and
// the customer/provider read models. Mirrors the service-info bilingual convention; these tests
// pin the trim/blank/limit/fallback rules and the fail-closed Json read.

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseFulfillmentInstructionsForm", () => {
  it("both languages present → trimmed bilingual value", () => {
    const r = parseFulfillmentInstructionsForm(
      form({ fulfillmentInstructionsAr: "  نقطة الاستلام  ", fulfillmentInstructionsEn: "  Pickup at the lobby  " }),
    );
    expect(r).toEqual({ ok: true, value: { ar: "نقطة الاستلام", en: "Pickup at the lobby" } });
  });

  it("one language only → the other stays empty (provider not forced to write both)", () => {
    expect(parseFulfillmentInstructionsForm(form({ fulfillmentInstructionsEn: "English only" }))).toEqual({
      ok: true,
      value: { ar: "", en: "English only" },
    });
    expect(parseFulfillmentInstructionsForm(form({ fulfillmentInstructionsAr: "عربي فقط" }))).toEqual({
      ok: true,
      value: { ar: "عربي فقط", en: "" },
    });
  });

  it("both blank / whitespace-only / absent → clear (value null)", () => {
    expect(parseFulfillmentInstructionsForm(form({}))).toEqual({ ok: true, value: null });
    expect(
      parseFulfillmentInstructionsForm(form({ fulfillmentInstructionsAr: "   ", fulfillmentInstructionsEn: "  " })),
    ).toEqual({ ok: true, value: null });
  });

  it("over the per-language ceiling → invalid (fail closed)", () => {
    expect(parseFulfillmentInstructionsForm(form({ fulfillmentInstructionsEn: "y".repeat(FULFILLMENT_TEXT_MAX + 1) })).ok).toBe(false);
    expect(parseFulfillmentInstructionsForm(form({ fulfillmentInstructionsAr: "ي".repeat(FULFILLMENT_TEXT_MAX + 1) })).ok).toBe(false);
  });

  it("exactly at the ceiling is accepted", () => {
    expect(parseFulfillmentInstructionsForm(form({ fulfillmentInstructionsEn: "y".repeat(FULFILLMENT_TEXT_MAX) })).ok).toBe(true);
  });

  it("a File value is never a valid instruction", () => {
    const fd = new FormData();
    fd.set("fulfillmentInstructionsEn", new File(["x"], "x.txt"));
    expect(parseFulfillmentInstructionsForm(fd)).toEqual({ ok: true, value: null });
  });
});

describe("fulfillmentInstructionsWrite", () => {
  it("null → Prisma.DbNull (clears the column)", () => {
    expect(fulfillmentInstructionsWrite(null)).toBe(Prisma.DbNull);
  });
  it("a value → the object itself (Prisma JSON input)", () => {
    expect(fulfillmentInstructionsWrite({ ar: "أ", en: "b" })).toEqual({ ar: "أ", en: "b" });
  });
});

describe("readFulfillmentInstructions (fail-closed)", () => {
  it("valid object → bilingual", () => {
    expect(readFulfillmentInstructions({ ar: "أ", en: "b" })).toEqual({ ar: "أ", en: "b" });
  });
  it.each([null, undefined, "a bare string", 42, ["ar", "en"], {}])("garbage %j → null", (bad) => {
    expect(readFulfillmentInstructions(bad)).toBeNull();
  });
  it("both blank → null", () => {
    expect(readFulfillmentInstructions({ ar: "  ", en: "" })).toBeNull();
  });
  it("missing keys default to empty; one present → kept", () => {
    expect(readFulfillmentInstructions({ en: "only en" })).toEqual({ ar: "", en: "only en" });
  });
});

describe("localizeFulfillmentInstructions", () => {
  const value = { ar: "التعليمات بالعربية", en: "Instructions in English" };
  it("ar locale → Arabic", () => {
    expect(localizeFulfillmentInstructions(value, "ar")).toBe("التعليمات بالعربية");
  });
  it("en/other locale → English", () => {
    expect(localizeFulfillmentInstructions(value, "en")).toBe("Instructions in English");
    expect(localizeFulfillmentInstructions(value, "fr")).toBe("Instructions in English");
  });
  it("falls back when the requested language is blank", () => {
    expect(localizeFulfillmentInstructions({ ar: "", en: "English" }, "ar")).toBe("English");
    expect(localizeFulfillmentInstructions({ ar: "عربي", en: "" }, "en")).toBe("عربي");
  });
  it("no usable text → null (UI renders nothing)", () => {
    expect(localizeFulfillmentInstructions(null, "en")).toBeNull();
    expect(localizeFulfillmentInstructions({ ar: "", en: "" }, "en")).toBeNull();
  });
});
