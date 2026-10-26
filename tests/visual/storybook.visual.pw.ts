import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// BARQ design lab — visual regression, accessibility (axe, WCAG 2.2 AA tags) and horizontal-overflow
// checks over the built Storybook. FOCUSED matrix (owner decision 2026-10-24), not a Cartesian product:
//   1. every story: default, Arabic AND English, 375 px — screenshot + axe + no horizontal overflow;
//   2. composed prototypes: also 430 × 932 and 1440 × 900 (Arabic);
//   3. 150 % and 200 % text: critical prototype screens + text-heavy components;
//   4. real :hover / :focus-visible / :active on the interactive component stories (disabled / error
//      are their own stories);
//   5. the three main prototype screens on an emulated phone (mobile-chromium project, @mobile).
// "Current app (before)" stories are the UNCHANGED app components: their axe findings are recorded as
// evidence (annotations), not failures — the proposals must pass.

type Entry = { id: string; title: string; name: string; type: string; tags?: string[] };
const index = JSON.parse(readFileSync("storybook-static/index.json", "utf8")) as { entries: Record<string, Entry> };
const stories = Object.values(index.entries).filter((e) => e.type === "story");

const isPrototype = (e: Entry) => e.tags?.includes("prototype") ?? false;
const isCurrent = (e: Entry) => e.title.startsWith("Current app");

const MAIN_PROTOTYPES = ["prototypes-1-vehicle-reading-consent--choose", "prototypes-2-vehicle-review--needs-review", "prototypes-3-trip-plan--mixed"];
const TEXT_SCALE = [
  ...MAIN_PROTOTYPES,
  "prototypes-1-vehicle-reading-consent--confirmed-details-open",
  "prototypes-3-trip-plan--no-services",
  "foundations-typography--scale",
  "components-form-field--states",
  "components-display--alerts",
  "components-display--status-badges",
  "components-display--sensitive-data-row-story",
  "components-trip--trip-day-timeline-story",
  "components-button--states",
];
const INTERACTIVE: Record<string, string> = {
  "components-button--default": "button",
  "components-form-field--default": "input",
  "components-display--accordion-story": "summary",
};

async function open(page: Page, id: string, locale: "ar" | "en", textScale = "100") {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=locale:${locale};textScale:${textScale}`);
  await page.waitForSelector("#storybook-root > *", { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await page.waitForTimeout(150);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(1);
}

const FULL_PAGE = { fullPage: true, stylePath: "tests/visual/full-page.css" } as const;

/** Full page (sticky bars in document position) + — for prototypes — the first screen as the user sees it. */
async function shots(page: Page, entry: Entry, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, FULL_PAGE);
  if (isPrototype(entry)) await expect(page).toHaveScreenshot(`${name}--first-screen.png`);
}

async function axe(page: Page, entry: Entry) {
  // Sticky bars are made static during the scan: otherwise axe's target-size rule reports whichever
  // control happens to sit under the sticky bar at the current scroll position (the user can scroll it
  // clear). Controls inside the bars are still scanned.
  const unstick = await page.addStyleTag({ path: "tests/visual/full-page.css" });
  const result = await new AxeBuilder({ page }).include("#storybook-root").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await unstick.evaluate((el) => (el as Element).remove());
  const found = result.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  test.info().annotations.push({ type: "axe", description: `${entry.id}: ${found.length ? found.join(" ; ") : "0 violations"}` });
  if (!isCurrent(entry)) expect(found, "axe violations").toEqual([]);
}

test.describe("1 · every story, default, AR + EN @ 375", () => {
  for (const entry of stories) {
    for (const locale of ["ar", "en"] as const) {
      test(`${entry.id} [${locale}]`, async ({ page }) => {
        await open(page, entry.id, locale);
        await noHorizontalOverflow(page);
        await axe(page, entry);
        await shots(page, entry, `${entry.id}--${locale}-375`);
      });
    }
  }
});

test.describe("2 · prototypes at 430 and 1440 (AR)", () => {
  for (const entry of stories.filter(isPrototype)) {
    for (const vp of [{ w: 430, h: 932 }, { w: 1440, h: 900 }]) {
      test(`${entry.id} [ar ${vp.w}]`, async ({ page }) => {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await open(page, entry.id, "ar");
        await noHorizontalOverflow(page);
        await axe(page, entry);
        await shots(page, entry, `${entry.id}--ar-${vp.w}`);
      });
    }
  }
});

test.describe("3 · text size 150 % / 200 % (AR @ 375)", () => {
  for (const id of TEXT_SCALE) {
    const entry = stories.find((s) => s.id === id);
    for (const scale of ["150", "200"]) {
      test(`${id} [ar ${scale}%]`, async ({ page }) => {
        expect(entry, `story ${id} exists`).toBeTruthy();
        await open(page, id, "ar", scale);
        await noHorizontalOverflow(page);
        await axe(page, entry!);
        await shots(page, entry!, `${id}--ar-375-text${scale}`);
      });
    }
  }
});

test.describe("4 · real hover / focus / pressed (AR @ 375)", () => {
  for (const [id, selector] of Object.entries(INTERACTIVE)) {
    test(`${id} [states]`, async ({ page }) => {
      await open(page, id, "ar");
      const target = page.locator(`#storybook-root ${selector}`).first();
      await target.hover();
      await expect(page).toHaveScreenshot(`${id}--hover.png`);
      await page.mouse.move(0, 0);
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
      await expect(page).toHaveScreenshot(`${id}--focus.png`);
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(page).toHaveScreenshot(`${id}--pressed.png`);
      await page.mouse.up();
    });
  }
});

test.describe("5 · main prototypes on an emulated phone", () => {
  for (const id of MAIN_PROTOTYPES) {
    test(`${id} [ar phone] @mobile`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile-chromium", "mobile project only");
      const entry = stories.find((s) => s.id === id)!;
      await open(page, id, "ar");
      await noHorizontalOverflow(page);
      await axe(page, entry);
      await shots(page, entry, `${id}--ar-phone`);
    });
  }
});
