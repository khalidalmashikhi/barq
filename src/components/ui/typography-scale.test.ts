import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// 2026-10-16 readability pass — the shared typography scale. Vitest has no layout engine, so the
// contract is asserted on the real stylesheet / Tailwind config / components; the rendered result
// (sizes, wrapping, touch targets, overflow at 375 / 430 / 1440) is measured in the browser and
// recorded in docs/project-memory/17 (2026-10-16).

const ROOT = process.cwd();
const CSS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const TW = readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8");
const BUTTON = readFileSync(path.join(ROOT, "src/components/ui/button.tsx"), "utf8");
const CONSENT = readFileSync(path.join(ROOT, "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx"), "utf8");

const block = (selector: string, from = 0) => {
  const i = CSS.indexOf(selector, from);
  expect(i, selector).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i) + 1);
};
const px = (rem: string) => Math.round(parseFloat(rem) * 16 * 100) / 100;
const tokens = (b: string) => Object.fromEntries([...b.matchAll(/--(text|leading)-([a-z0-9]+):\s*([0-9.]+)(rem)?;/g)].map((m) => [`${m[1]}-${m[2]}`, m[4] ? px(m[3]!) : parseFloat(m[3]!)]));

const MOBILE = tokens(block(":root {\n  --text-xs"));
const DESKTOP = tokens(block(":root {", CSS.indexOf("@media (min-width: 1024px)")));
const ARABIC = tokens(block('html[lang="ar"] {'));

describe("14. the scale — phones first, calm on desktop, never tiny", () => {
  it("every Tailwind text size xs…3xl is driven by the tokens (no per-file sizes needed)", () => {
    for (const k of ["xs", "sm", "base", "lg", "xl"]) expect(TW).toContain(`${k}: ["var(--text-${k})", { lineHeight: "var(--leading-${k})" }]`);
    for (const k of ["2xl", "3xl"]) expect(TW).toContain(`"${k}": ["var(--text-${k})", { lineHeight: "var(--leading-${k})" }]`);
  });

  it("phones: body 17 px, helper/status 16 px, metadata 15 px, section 22–26 px, page title 30 px, labels 17 px", () => {
    expect(MOBILE["text-base"]).toBe(17);
    expect(MOBILE["text-sm"]).toBe(16);
    expect(MOBILE["text-xs"]).toBe(15);
    expect(MOBILE["text-xl"]).toBeGreaterThanOrEqual(22);
    expect(MOBILE["text-2xl"]).toBeLessThanOrEqual(26);
    expect(MOBILE["text-3xl"]).toBeGreaterThanOrEqual(28);
    expect(MOBILE["text-3xl"]).toBeLessThanOrEqual(32);
    expect(MOBILE["text-label"]).toBeGreaterThanOrEqual(17);
  });

  it("desktop (≥1024 px) is not oversized and still never below 14 px", () => {
    expect(DESKTOP["text-base"]).toBe(16);
    expect(DESKTOP["text-sm"]).toBe(15);
    expect(DESKTOP["text-xs"]).toBe(14);
    for (const v of Object.entries(DESKTOP).filter(([k]) => k.startsWith("text-"))) expect(v[1], v[0]).toBeGreaterThanOrEqual(14);
  });

  it("line height: English body 1.5–1.65; Arabic body 1.65–1.8 (and Arabic prose 1.75)", () => {
    expect(MOBILE["leading-base"]).toBeGreaterThanOrEqual(1.5);
    expect(MOBILE["leading-base"]).toBeLessThanOrEqual(1.65);
    expect(ARABIC["leading-base"]).toBeGreaterThanOrEqual(1.65);
    expect(ARABIC["leading-base"]).toBeLessThanOrEqual(1.8);
    expect(ARABIC["leading-sm"]).toBeGreaterThanOrEqual(1.65);
    expect(CSS).toMatch(/\[dir="rtl"\] p \{\s*line-height: 1\.75;/);
  });

  it("the body uses the token size, honours zoom (rem) and does not let iOS inflate text unpredictably", () => {
    const body = block("body {\n  background-color");
    expect(body).toMatch(/font-size: var\(--text-base\);/);
    expect(body).toMatch(/line-height: var\(--leading-base\);/);
    expect(body).toMatch(/-webkit-text-size-adjust: 100%;/);
    expect(CSS).not.toMatch(/--text-[a-z0-9]+:\s*[0-9.]+px/); // rem only
  });

  it("a primary form label is 17 px semibold on phones and never shouted in small capitals", () => {
    const label = block(".form-label {");
    expect(label).toMatch(/font-size: var\(--text-label\);/);
    expect(label).toMatch(/font-weight: 600;/);
    expect(label).not.toMatch(/uppercase/);
  });
});

describe("15–17. wrapping, touch targets, direction", () => {
  it("16. the shared Button is at least 44 px tall with base-size semibold text; consent actions are 48 px", () => {
    expect(BUTTON).toContain('"inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-base font-semibold"');
    // the journey's shared action classes (2026-10-16 visual checkpoint) — 48 px, base size, semibold
    const UI = readFileSync(path.join(ROOT, "src/components/provider/vehicle-journey/journey-ui.ts"), "utf8");
    for (const name of ["JOURNEY_PRIMARY", "JOURNEY_SECONDARY", "JOURNEY_TERTIARY"]) expect(UI, name).toMatch(new RegExp(`export const ${name} = \`inline-flex min-h-12 [^\`]*text-base font-(semibold|medium)`));
    expect(UI).toMatch(/export const JOURNEY_SMALL = `inline-flex min-h-11 /);
    expect(CONSENT).toMatch(/className=\{`\$\{JOURNEY_PRIMARY\} w-full`\}/);
    expect(CONSENT).toMatch(/className="mt-0\.5 size-6 shrink-0 accent-primary"/); // a 24 px checkbox inside a full-width label
  });

  it("15/17. labels wrap (no nowrap / fixed height on text), spacing is logical so RTL and LTR mirror", () => {
    for (const rel of [
      "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx",
      "src/app/[locale]/provider/vehicles/[id]/_components/registration-confirmation-form.tsx",
      "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx",
    ]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/form-label[^"]*whitespace-nowrap|form-label[^"]*\btruncate\b/);
      expect(src, rel).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    }
  });

  it("no meaningful text in the app uses an arbitrary size below 14 px — only count bubbles / calendar markers / a decorative avatar placeholder may", () => {
    const allowed = new Set([
      "src/components/app-shell/app-sidebar.tsx",
      "src/components/app-shell/app-mobile-nav.tsx",
      "src/components/app-shell/notification-bell.tsx",
      "src/components/provider/notifications-panel.tsx",
      "src/app/[locale]/provider/vehicle-rentals/_components/availability-calendar.tsx",
      "src/app/[locale]/provider/settings/page.tsx",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) {
          const rel = path.relative(ROOT, full).split(path.sep).join("/");
          const src = readFileSync(full, "utf8");
          for (const m of src.matchAll(/text-\[([0-9.]+)(px|rem)\]/g)) {
            const size = m[2] === "rem" ? parseFloat(m[1]!) * 16 : parseFloat(m[1]!);
            if (size < 14 && !allowed.has(rel)) offenders.push(`${rel}: ${m[0]}`);
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
