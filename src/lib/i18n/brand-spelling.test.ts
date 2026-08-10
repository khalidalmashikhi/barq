import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Marketplace Phase 0 — brand-spelling regression. The Arabic brand name is
// "برق"; "بارق" (with an extra ا) is WRONG and must never reappear in any
// production user-facing message bundle. This guards every locale's JSON so a
// future edit or copy-paste can't silently reintroduce the misspelling.
const MESSAGES_DIR = join(process.cwd(), "messages");
const WRONG = "بارق";
const CORRECT = "برق";

const localeDirs = readdirSync(MESSAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe("Arabic brand spelling (برق, never بارق)", () => {
  it("has locale message directories to check", () => {
    expect(localeDirs.length).toBeGreaterThan(0);
  });

  for (const locale of localeDirs) {
    const files = readdirSync(join(MESSAGES_DIR, locale)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      it(`messages/${locale}/${file} contains no "بارق"`, () => {
        const content = readFileSync(join(MESSAGES_DIR, locale, file), "utf8");
        expect(content.includes(WRONG)).toBe(false);
      });
    }
  }

  it("the correct Arabic brand appName is برق", () => {
    const common = JSON.parse(readFileSync(join(MESSAGES_DIR, "ar", "common.json"), "utf8"));
    expect(common.appName).toBe(CORRECT);
  });
});
