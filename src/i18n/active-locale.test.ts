import { describe, it, expect } from "vitest";
import { getLocaleFromPathname, resolveActiveLocale, LOCALE_LABELS } from "./active-locale";
import { locales } from "./locales";

// Focused tests for the language-switcher active-label fix. The bug: the
// displayed language could remain stuck on the previously selected locale
// after navigation (e.g. `/ar` rendered while the switcher still showed
// "Čeština"), because the label came from next-intl's `useLocale()`, which
// is served by a root-layout provider that a soft navigation preserves.
// The fix derives the active locale from the routed URL. These tests pin
// that URL→locale→label mapping across all 8 locales.

// The exact native-script labels the switcher must show per the spec.
const EXPECTED_LABEL: Record<(typeof locales)[number], string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  pl: "Polski",
  fr: "Français",
  cs: "Čeština",
  ru: "Русский",
};

describe("getLocaleFromPathname", () => {
  it("extracts the routed locale from every bare locale root", () => {
    for (const locale of locales) {
      expect(getLocaleFromPathname(`/${locale}`)).toBe(locale);
    }
  });

  it("extracts the routed locale from a deeper route", () => {
    expect(getLocaleFromPathname("/en/services")).toBe("en");
    expect(getLocaleFromPathname("/de/services/abc123")).toBe("de");
    expect(getLocaleFromPathname("/ru/admin/users")).toBe("ru");
  });

  it("ignores a trailing query string and hash", () => {
    expect(getLocaleFromPathname("/pl/services?x=1")).toBe("pl");
    expect(getLocaleFromPathname("/fr/services#reviews")).toBe("fr");
    expect(getLocaleFromPathname("/cs?x=1#top")).toBe("cs");
  });

  it("returns undefined when there is no valid leading locale segment", () => {
    expect(getLocaleFromPathname("/")).toBeUndefined();
    expect(getLocaleFromPathname("")).toBeUndefined();
    expect(getLocaleFromPathname("/services")).toBeUndefined();
    expect(getLocaleFromPathname("/xx/services")).toBeUndefined();
  });

  it("reads only the FIRST segment (the routed locale), never a later one", () => {
    // A later segment that merely equals a locale code is not the route's locale.
    expect(getLocaleFromPathname("/en/services/de")).toBe("en");
  });
});

describe("resolveActiveLocale", () => {
  it("returns the URL locale for every one of the 8 locales", () => {
    for (const locale of locales) {
      expect(resolveActiveLocale(`/${locale}`)).toBe(locale);
      expect(resolveActiveLocale(`/${locale}/services`)).toBe(locale);
    }
  });

  it("lets the routed URL win even when the fallback (useLocale) is a DIFFERENT, stale locale", () => {
    // This is the exact staleness bug: URL says /ar, provider still says cs.
    expect(resolveActiveLocale("/ar", "cs")).toBe("ar");
    // Across the full matrix: the URL locale must always beat any stale fallback.
    for (const urlLocale of locales) {
      for (const staleLocale of locales) {
        expect(resolveActiveLocale(`/${urlLocale}/services`, staleLocale)).toBe(urlLocale);
      }
    }
  });

  it("falls back to next-intl's locale only when the path has no locale segment", () => {
    expect(resolveActiveLocale("/", "de")).toBe("de");
    expect(resolveActiveLocale("/services", "ru")).toBe("ru");
  });

  it("falls back to the default locale when neither path nor fallback is a valid locale", () => {
    expect(resolveActiveLocale("/")).toBe("ar");
    expect(resolveActiveLocale("/", "not-a-locale")).toBe("ar");
  });
});

describe("active switcher label (URL → displayed language)", () => {
  it("shows the correct native-script label for each locale in the URL", () => {
    const expectations: ReadonlyArray<readonly [string, string]> = [
      ["/ar", "العربية"],
      ["/en", "English"],
      ["/de", "Deutsch"],
      ["/it", "Italiano"],
      ["/pl", "Polski"],
      ["/fr", "Français"],
      ["/cs", "Čeština"],
      ["/ru", "Русский"],
    ];
    for (const [url, label] of expectations) {
      expect(LOCALE_LABELS[resolveActiveLocale(url)]).toBe(label);
    }
  });

  it("shows no stale previous-locale label after a route change (all 8 -> all 8)", () => {
    // Simulate: was on `previous`, navigated to `next`; provider still holds
    // `previous`. The label must reflect `next`, never `previous`.
    for (const previous of locales) {
      for (const next of locales) {
        const label = LOCALE_LABELS[resolveActiveLocale(`/${next}`, previous)];
        expect(label).toBe(EXPECTED_LABEL[next]);
        if (previous !== next) {
          expect(label).not.toBe(EXPECTED_LABEL[previous]);
        }
      }
    }
  });

  it("has a label defined for all 8 locales and no extras", () => {
    expect(Object.keys(LOCALE_LABELS).sort()).toEqual([...locales].sort());
  });
});
