import { describe, it, expect } from "vitest";
import { extractLocalizedText } from "./extract-localized-text";

// Phase 5.1 (Production Readiness) — regression tests for the
// fallback chain (requested locale -> ar -> en -> "") this helper is
// documented to implement. Previously unused (extractText() was called
// everywhere instead, hardcoding "ar" regardless of the real request
// locale) — these tests exist because this phase is what actually
// wires it in for the first time.

describe("extractLocalizedText", () => {
  it("returns the requested locale's value when present and non-empty", () => {
    expect(extractLocalizedText({ ar: "قهوة", en: "Coffee" }, "en")).toBe("Coffee");
    expect(extractLocalizedText({ ar: "قهوة", en: "Coffee" }, "ar")).toBe("قهوة");
  });

  it("falls back to Arabic when the requested locale is missing", () => {
    expect(extractLocalizedText({ ar: "قهوة" }, "fr")).toBe("قهوة");
  });

  it("falls back to Arabic when the requested locale's value is an empty string", () => {
    expect(extractLocalizedText({ ar: "قهوة", fr: "" }, "fr")).toBe("قهوة");
  });

  it("falls back to English when neither the requested locale nor Arabic has a usable value", () => {
    expect(extractLocalizedText({ en: "Coffee" }, "fr")).toBe("Coffee");
    expect(extractLocalizedText({ ar: "", en: "Coffee" }, "fr")).toBe("Coffee");
  });

  it("returns an empty string when no level has a usable value", () => {
    expect(extractLocalizedText({}, "en")).toBe("");
    expect(extractLocalizedText({ ar: "", en: "" }, "fr")).toBe("");
  });

  it("returns an empty string for non-object or null input", () => {
    expect(extractLocalizedText(null, "en")).toBe("");
    expect(extractLocalizedText(undefined, "en")).toBe("");
    expect(extractLocalizedText("plain string", "en")).toBe("");
    expect(extractLocalizedText(42, "en")).toBe("");
  });
});
