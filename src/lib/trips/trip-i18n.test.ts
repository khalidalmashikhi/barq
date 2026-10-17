import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TRIP_INTERESTS, TRIP_MOBILITY, TRIP_PACES } from "./trip-input";
import { TRIP_NOTE_KEYS, TRIP_PERIODS, TRIP_SUGGESTION_KEYS } from "./trip-plan";
import { isCustomerBottomNavSurface } from "@/components/layout/bottom-nav-tabs";

// 2026-10-17 — Trip planner: every key the planner and the island can render exists, non-empty, in
// all 8 languages (a missing key would show a raw code); the approved entry wording is exact.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(process.cwd(), `messages/${l}/trips.json`), "utf8")) as Record<string, string>]));
const KEYS = [
  ...TRIP_SUGGESTION_KEYS,
  ...TRIP_NOTE_KEYS,
  ...TRIP_INTERESTS.map((i) => `interest_${i}`),
  ...TRIP_PACES.flatMap((p) => [`pace_${p}`, `paceHint_${p}`]),
  ...TRIP_MOBILITY.map((m) => `mobility_${m}`),
  ...TRIP_PERIODS.map((p) => `period_${p}`),
];

describe("trip planner copy", () => {
  it.each(LOCALES)("%s has every rendered key and the same key set as English", (l) => {
    for (const k of KEYS) expect(messages[l]![k]?.trim().length ?? 0, `${l}.${k}`).toBeGreaterThan(0);
    expect(Object.keys(messages[l]!).sort()).toEqual(Object.keys(messages.en!).sort());
  });

  it("entry and labels read exactly as approved; the plan never claims a booking or a guarantee", () => {
    expect(messages.ar!.homeCardTitle).toBe("خطط رحلتك");
    expect(messages.en!.homeCardTitle).toBe("Plan your trip");
    expect(messages.en!.badgeBookable).toBe("Available to book on BARQ");
    expect(messages.en!.badgeGeneral).toBe("General trip suggestion");
    for (const l of LOCALES) expect(messages[l]!.planDisclaimer, l).not.toMatch(/guarantee|garant|gwarant|zaruč|гарант|مضمون/i);
    expect(messages.en!.planDisclaimer).toMatch(/not a booking/);
    expect(messages.ar!.planDisclaimer).toMatch(/ليست حجزًا/);
  });

  it("general suggestions name no place, price or time (no invented facts)", () => {
    for (const l of LOCALES) for (const k of TRIP_SUGGESTION_KEYS) expect(messages[l]![k], `${l}.${k}`).not.toMatch(/\d|OMR|ر\.ع|Muttrah|Nizwa|Sur|Salalah|مطرح|نزوى|صلالة/);
  });

  it("the planner page is a customer surface (bottom navigation shows) — separate from provider onboarding", () => {
    expect(isCustomerBottomNavSurface("/trips")).toBe(true);
    expect(isCustomerBottomNavSurface("/provider/vehicles/new")).toBe(false);
  });
});
