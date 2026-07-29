import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Production Blocker fix — regression guard for the 1,122-string
// translation gap closed this phase (real translations for cs/de/fr/it/
// pl/ru across these 9 namespaces, replacing every literal "[xx] key —
// not yet translated" placeholder). Without an automated check, this
// exact gap could silently reappear the next time a key is added to
// messages/en/*.json and the other locales aren't updated in lockstep —
// this test fails loudly, per-locale and per-namespace, the moment that
// happens again, rather than relying on a future manual audit to
// rediscover it.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const NAMESPACES = [
  "auth",
  "booking",
  "common",
  "dashboard",
  "errors",
  "notifications",
  "provider",
  "seo",
  "services",
] as const;

function loadNamespace(locale: string, namespace: string): Record<string, unknown> {
  const filePath = join(process.cwd(), "messages", locale, `${namespace}.json`);
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

describe("translation completeness (Production Blocker fix)", () => {
  for (const namespace of NAMESPACES) {
    describe(namespace, () => {
      const enKeys = Object.keys(loadNamespace("en", namespace)).sort();

      for (const locale of LOCALES) {
        if (locale === "en") continue;

        it(`messages/${locale}/${namespace}.json has no unreplaced "not yet translated" placeholder`, () => {
          const data = loadNamespace(locale, namespace);

          // "phase0Placeholder" is a deliberately-preserved infrastructure
          // marker (present in every locale, including en) — never a
          // real, user-facing UI string, and out of scope for this check.
          const remainingPlaceholderKeys = Object.entries(data)
            .filter(
              ([key, value]) =>
                key !== "phase0Placeholder" && typeof value === "string" && value.includes("not yet translated")
            )
            .map(([key]) => key);

          expect(remainingPlaceholderKeys).toEqual([]);
        });

        it(`messages/${locale}/${namespace}.json has the exact same key set as messages/en/${namespace}.json`, () => {
          const keys = Object.keys(loadNamespace(locale, namespace)).sort();
          expect(keys).toEqual(enKeys);
        });
      }
    });
  }
});
