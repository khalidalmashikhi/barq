import { describe, it, expect } from "vitest";
import { switchLocalePath } from "./switch-locale-path";
import { locales } from "./locales";

// Focused unit tests for the locale-switch normalizer — the fix for the
// duplicate-locale-segment bug (`/de/en`, `/pl/it`, `/fr/fr`, `/ru/cs`).

const LOCALE_ROOTS = ["/ar", "/en", "/de", "/it", "/pl", "/fr", "/cs", "/ru"];

// A path segment is a "locale segment" if it exactly equals one of the 8
// codes. Two consecutive locale segments is the exact defect under test.
function hasTwoConsecutiveLocaleSegments(path: string): boolean {
  const pathnameOnly = path.split("#")[0]!.split("?")[0]!;
  const segments = pathnameOnly.split("/").filter((s) => s.length > 0);
  const isLocale = (value: string | undefined): boolean =>
    value !== undefined && (locales as readonly string[]).includes(value);
  for (let i = 0; i < segments.length - 1; i++) {
    if (isLocale(segments[i]) && isLocale(segments[i + 1])) {
      return true;
    }
  }
  return false;
}

describe("switchLocalePath", () => {
  it("switches a bare locale root: /ar -> de = /de", () => {
    expect(switchLocalePath("/ar", "de")).toBe("/de");
  });

  it("replaces the locale and keeps the route: /en/services -> fr = /fr/services", () => {
    expect(switchLocalePath("/en/services", "fr")).toBe("/fr/services");
  });

  it("normalizes an already-duplicated path: /de/en -> it = /it", () => {
    expect(switchLocalePath("/de/en", "it")).toBe("/it");
  });

  it("preserves the query string: /pl/it?x=1 -> cs = /cs?x=1", () => {
    expect(switchLocalePath("/pl/it?x=1", "cs")).toBe("/cs?x=1");
  });

  it("does not duplicate the segment when switching to the active locale", () => {
    expect(switchLocalePath("/de/services", "de")).toBe("/de/services");
    expect(switchLocalePath("/fr", "fr")).toBe("/fr");
    // The reported `/fr/fr` case must collapse back to a single `/fr`.
    expect(switchLocalePath("/fr/fr", "fr")).toBe("/fr");
  });

  it("preserves query parameters on a deeper route", () => {
    expect(switchLocalePath("/en/services/abc123?ref=home&sort=asc", "ru")).toBe(
      "/ru/services/abc123?ref=home&sort=asc"
    );
  });

  it("preserves the hash when present", () => {
    expect(switchLocalePath("/en/services#reviews", "de")).toBe("/de/services#reviews");
  });

  it("preserves both query string and hash together", () => {
    expect(switchLocalePath("/pl/services/abc?x=1#top", "cs")).toBe("/cs/services/abc?x=1#top");
  });

  it("switches the homepage root: / -> de = /de", () => {
    expect(switchLocalePath("/", "de")).toBe("/de");
  });

  it("collapses three stray leading locale segments to one", () => {
    expect(switchLocalePath("/ru/cs/en/bookings", "ar")).toBe("/ar/bookings");
  });

  it("only strips LEADING locale segments, never later path data", () => {
    // A later segment that merely equals a locale code is real route data.
    expect(switchLocalePath("/en/services/en", "de")).toBe("/de/services/en");
  });

  it("works from every app surface (home, services, details, login, dashboard, admin, provider, customer)", () => {
    const surfaces = [
      ["/de", "/it"],
      ["/de/services", "/it/services"],
      ["/de/services/abc123", "/it/services/abc123"],
      ["/de/login", "/it/login"],
      ["/de/dashboard", "/it/dashboard"],
      ["/de/admin/users", "/it/admin/users"],
      ["/de/provider/bookings", "/it/provider/bookings"],
      ["/de/bookings/xyz/confirmation", "/it/bookings/xyz/confirmation"],
    ] as const;
    for (const [from, expected] of surfaces) {
      expect(switchLocalePath(from, "it")).toBe(expected);
    }
  });

  it("supports all 8 locales as switch targets, each yielding exactly one valid root", () => {
    for (const target of locales) {
      const result = switchLocalePath("/en/services?x=1#h", target);
      expect(result).toBe(`/${target}/services?x=1#h`);
      expect(LOCALE_ROOTS.some((root) => result === root || result.startsWith(`${root}/`) || result.startsWith(`${root}?`) || result.startsWith(`${root}#`))).toBe(true);
    }
  });

  it("never produces two consecutive locale segments, across a matrix of inputs and targets", () => {
    const inputs = [
      "/",
      "/ar",
      "/en/services",
      "/de/en",
      "/pl/it?x=1",
      "/fr/fr",
      "/ru/cs",
      "/de/en/it/pl/services#x",
      "/en/services/en",
    ];
    for (const input of inputs) {
      for (const target of locales) {
        const result = switchLocalePath(input, target);
        expect(hasTwoConsecutiveLocaleSegments(result)).toBe(false);
      }
    }
  });
});
