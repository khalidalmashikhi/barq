import { test, expect, type Page } from "@playwright/test";

// BARQ design lab — LAYOUT GUARD for large text (owner correction 2026-10-26). Measures, on the three
// composed screens (consent · vehicle review · trip plan) in their default / error / disabled states,
// Arabic + English, 375 × 812 and 430 × 932, root text 100 / 150 / 200 %:
//   1. no horizontal overflow;
//   2. a sticky action bar is at most 30 % of the phone screen height;
//   3. every button / field / link of the page content can be scrolled fully into the area between
//      the sticky header and the sticky bar / bottom nav (nothing lives behind the bar);
//   4. keyboard focus never leaves the focused control hidden behind a sticky bar (Tab traversal);
//   5. the last content element ends above the bar / nav and the iPhone home-indicator inset, and the
//      bar's own controls end above that inset (emulated: --ds-test-safe-bottom = 34 px);
//   6. bottom-nav labels are never clipped or truncated (≤ 2 lines), and every destination stays
//      reachable (directly or through "More").
// Metrics are attached to each test (annotation "layout") so before / after can be compared.

const SAFE_BOTTOM = 34;

const SCREENS: { id: string; state: "default" | "error" | "disabled" | "empty" }[] = [
  { id: "prototypes-1-vehicle-reading-consent--confirmed-details-open", state: "default" },
  { id: "prototypes-1-vehicle-reading-consent--reading-failed", state: "error" },
  { id: "prototypes-1-vehicle-reading-consent--choose", state: "disabled" },
  { id: "prototypes-2-vehicle-review--ready", state: "default" },
  { id: "prototypes-2-vehicle-review--save-error", state: "error" },
  { id: "prototypes-2-vehicle-review--needs-review", state: "disabled" },
  { id: "prototypes-3-trip-plan--mixed", state: "default" },
  { id: "prototypes-3-trip-plan--rate-limited", state: "error" },
  { id: "prototypes-3-trip-plan--no-services", state: "empty" },
  // large-text bar options A / B (measured side by side; A is the chosen default)
  { id: "prototypes-1-vehicle-reading-consent--large-text-option-a", state: "disabled" },
  { id: "prototypes-1-vehicle-reading-consent--large-text-option-b", state: "disabled" },
  { id: "prototypes-2-vehicle-review--large-text-option-a", state: "disabled" },
  { id: "prototypes-2-vehicle-review--large-text-option-b", state: "disabled" },
];

type Metrics = {
  overflowX: number;
  barRatio: number | null;
  barSticky: boolean;
  headerH: number;
  hiddenControls: string[];
  focusHidden: string[];
  lastGap: number | null;
  barControlsAboveSafe: boolean | null;
  navRatio: number | null;
  navClipped: string[];
  navMaxLines: number | null;
  navDestinations: number | null;
  /** comparison metrics: primary action fully visible at scroll 0, scroll needed to reach it, share of the screen left for content */
  primaryAtTop: boolean | null;
  scrollToPrimary: number | null;
  contentRatio: number;
};

async function open(page: Page, id: string, locale: string, scale: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=locale:${locale};textScale:${scale}`);
  await page.waitForSelector("#storybook-root > *", { timeout: 20_000 });
  await page.evaluate(async (safe) => {
    document.documentElement.style.setProperty("--ds-test-safe-bottom", `${safe}px`);
    await document.fonts.ready;
  }, SAFE_BOTTOM);
  await page.waitForTimeout(200);
}

/** Sticky elements of the screen: header (top), action bar (bottom, not nav), bottom nav. */
async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(async (safe) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = document.querySelector("#storybook-root")!;
    const all = [...root.querySelectorAll<HTMLElement>("*")];
    const sticky = all.filter((el) => getComputedStyle(el).position === "sticky" && el.getBoundingClientRect().height > 0);
    const header = sticky.find((el) => getComputedStyle(el).top === "0px") ?? null;
    const nav = sticky.find((el) => el.tagName === "NAV" && getComputedStyle(el).bottom === "0px") ?? null;
    // the VISIBLE bar (a hidden desktop-aside copy must not be measured instead)
    const shown = (el: HTMLElement) => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 0;
    const bar = ([...root.querySelectorAll<HTMLElement>("[data-ds-sticky-bar]")].find(shown) ?? sticky.find((el) => el.tagName !== "NAV" && getComputedStyle(el).bottom === "0px")) || null;
    const barSticky = !!bar && getComputedStyle(bar).position === "sticky";
    const vh = innerHeight;
    window.scrollTo(0, 0);
    await frame();
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const barH = bar && barSticky ? bar.getBoundingClientRect().height : 0;
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const bottomObstruction = () => {
      const tops = [vh - safe];
      if (bar && barSticky) tops.push(bar.getBoundingClientRect().top);
      if (nav) tops.push(nav.getBoundingClientRect().top);
      return Math.min(...tops);
    };
    // primary action of a task screen = first visible button of the visible bar
    const primaryBtn = bar ? ([...bar.querySelectorAll<HTMLElement>("button")].find((b) => b.getBoundingClientRect().height > 0) ?? null) : null;
    const pr = primaryBtn ? primaryBtn.getBoundingClientRect() : null;
    const primaryAtTop = pr ? pr.top >= headerH - 0.5 && pr.bottom <= vh - safe + 0.5 : null;
    const scrollToPrimary = pr ? Math.max(0, Math.round(pr.bottom - (vh - safe))) : null;
    const contentRatio = Math.round(((Math.min(vh - safe, bar && barSticky ? bar.getBoundingClientRect().top : vh, nav ? nav.getBoundingClientRect().top : vh) - headerH) / vh) * 1000) / 1000;
    const name = (el: HTMLElement) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28)}`;
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const inside = (el: HTMLElement, box: HTMLElement | null) => !!box && box.contains(el);

    // 3 · every content control can be scrolled fully into the unobstructed area
    const controls = [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary")].filter((el) => visible(el) && !inside(el, header) && !inside(el, nav) && !(barSticky && inside(el, bar)));
    const hiddenControls: string[] = [];
    const maxScroll = () => document.documentElement.scrollHeight - vh;
    for (const el of controls) {
      const abs = el.getBoundingClientRect().top + scrollY;
      const h = el.getBoundingClientRect().height;
      // bottom-anchored: scroll so the control sits just above the bottom obstruction
      window.scrollTo(0, Math.max(0, Math.min(maxScroll(), abs + h - bottomObstruction() + 4)));
      await frame();
      let r = el.getBoundingClientRect();
      let ok = r.top >= headerH - 0.5 && r.bottom <= bottomObstruction() + 0.5;
      if (!ok) {
        window.scrollTo(0, Math.max(0, Math.min(maxScroll(), abs - headerH - 4)));
        await frame();
        r = el.getBoundingClientRect();
        ok = r.top >= headerH - 0.5 && r.bottom <= bottomObstruction() + 0.5;
      }
      if (!ok) hiddenControls.push(name(el));
    }

    // 5 · last content element (at maximum scroll) ends above the bar / nav / safe area
    window.scrollTo(0, maxScroll());
    await frame();
    const main = root.querySelector<HTMLElement>("main");
    const lastEl = main ? ([...main.querySelectorAll<HTMLElement>("*")].filter(visible).pop() ?? main) : null;
    const lastGap = lastEl ? Math.round(bottomObstruction() - lastEl.getBoundingClientRect().bottom) : null;
    let barControlsAboveSafe: boolean | null = null;
    if (bar) {
      const ctrls = [...bar.querySelectorAll<HTMLElement>("button, a[href]")].filter(visible);
      barControlsAboveSafe = ctrls.every((c) => c.getBoundingClientRect().bottom <= vh - safe + 0.5);
    }
    window.scrollTo(0, 0);
    await frame();

    // 6 · bottom navigation labels
    let navClipped: string[] = [];
    let navMaxLines: number | null = null;
    let navDestinations: number | null = null;
    if (nav) {
      const labels = [...nav.querySelectorAll<HTMLElement>("[data-ds-nav-label], a > span:last-child, button > span:last-child")].filter(visible);
      // actually clipped (content wider / taller than its box) — an ellipsis style that never triggers is not clipping
      navClipped = labels.filter((l) => l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1).map((l) => (l.textContent ?? "").trim());
      navMaxLines = Math.max(0, ...labels.map((l) => Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight))));
      navDestinations = nav.querySelectorAll("a[href]").length;
    }
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      barRatio: bar ? Math.round((barH / vh) * 1000) / 1000 : null,
      barSticky,
      headerH: Math.round(headerH),
      hiddenControls,
      focusHidden: [],
      lastGap,
      barControlsAboveSafe,
      navRatio: nav ? Math.round((navH / vh) * 1000) / 1000 : null,
      navClipped,
      navMaxLines,
      navDestinations,
      primaryAtTop,
      scrollToPrimary,
      contentRatio,
    };
  }, SAFE_BOTTOM);
}

/** 4 · Tab through the page: the focused control must not be hidden behind a sticky bar / nav. */
async function focusTraversal(page: Page): Promise<string[]> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const hidden: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    // let the page react to focus (one-frame focus-visibility correction) before measuring
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const res = await page.evaluate((safe) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !document.querySelector("#storybook-root")!.contains(el)) return { done: true, hidden: null as string | null };
      const root = document.querySelector("#storybook-root")!;
      const sticky = [...root.querySelectorAll<HTMLElement>("*")].filter((x) => getComputedStyle(x).position === "sticky" && x.getBoundingClientRect().height > 0);
      if (sticky.some((s) => s.contains(el))) return { done: false, hidden: null };
      const r = el.getBoundingClientRect();
      const top = Math.max(0, ...sticky.filter((s) => getComputedStyle(s).top === "0px").map((s) => s.getBoundingClientRect().bottom));
      const bottom = Math.min(innerHeight - safe, ...sticky.filter((s) => getComputedStyle(s).bottom === "0px").map((s) => s.getBoundingClientRect().top));
      const fully = r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
      return { done: false, hidden: fully ? null : `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28)}` };
    }, SAFE_BOTTOM);
    if (res.done) break;
    if (res.hidden) hidden.push(res.hidden);
  }
  return [...new Set(hidden)];
}

/** "More" navigation (large text): every destination must be listed with its full label. */
async function moreMenu(page: Page): Promise<{ present: boolean; destinations: number; clipped: string[] }> {
  const more = page.locator("[data-ds-nav-more]");
  if ((await more.count()) === 0 || !(await more.first().isVisible())) return { present: false, destinations: 0, clipped: [] };
  await more.first().click();
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>("[data-ds-nav-sheet]");
    if (!sheet) return { present: true, destinations: 0, clipped: ["(sheet missing)"] };
    const links = [...sheet.querySelectorAll<HTMLElement>("a[href]")];
    const clipped = links.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => (l.textContent ?? "").trim());
    return { present: true, destinations: links.length, clipped };
  });
}

for (const s of SCREENS) {
  for (const locale of ["ar", "en"] as const) {
    for (const vp of [{ w: 375, h: 812 }, { w: 430, h: 932 }]) {
      for (const scale of ["100", "150", "200"]) {
        test(`layout · ${s.id} · ${s.state} · ${locale} ${vp.w} @${scale}%`, async ({ page }, info) => {
          test.skip(info.project.name !== "chromium", "chromium project only");
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await open(page, s.id, locale, scale);
          const m = await measure(page);
          m.focusHidden = await focusTraversal(page);
          const more = m.navDestinations !== null ? await moreMenu(page) : null;
          info.annotations.push({ type: "layout", description: JSON.stringify({ id: s.id, state: s.state, locale, vp: vp.w, scale, ...m, more }) });

          expect(m.overflowX, "horizontal overflow (px)").toBeLessThanOrEqual(1);
          if (m.barRatio !== null && m.barSticky) expect(m.barRatio, "sticky bar height / screen height").toBeLessThanOrEqual(0.3);
          expect(m.hiddenControls, "controls that cannot be scrolled clear of the sticky bar / nav").toEqual([]);
          expect(m.focusHidden, "focused controls hidden behind a sticky bar / nav").toEqual([]);
          if (m.lastGap !== null) expect(m.lastGap, "last element ends above bar / nav / safe area (px)").toBeGreaterThanOrEqual(0);
          if (m.barControlsAboveSafe !== null) expect(m.barControlsAboveSafe, "bar controls above the home-indicator inset").toBe(true);
          if (m.navDestinations !== null) {
            expect(m.navClipped, "clipped / truncated nav labels").toEqual([]);
            expect(m.navMaxLines ?? 0, "nav label lines").toBeLessThanOrEqual(2);
            const reachable = Math.max(m.navDestinations, more?.present ? more.destinations : 0);
            expect(reachable, "navigation destinations reachable").toBeGreaterThanOrEqual(5);
            if (more?.present) expect(more.clipped, "clipped labels in More").toEqual([]);
          }
        });
      }
    }
  }
}
