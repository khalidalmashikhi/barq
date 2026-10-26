import { defineConfig, devices } from "@playwright/test";

// Design-lab visual regression + accessibility over the BUILT Storybook (`npm run build-storybook`).
// Served by scripts/engineering/serve-static.mjs on 127.0.0.1 only; baselines and results stay local
// (tests/visual/__screenshots__ and tests/visual/results are git-ignored — never committed).
// Projects: desktop Chromium and a mobile Chromium profile. WebKit is intentionally absent until its
// system dependencies are available on this host.

export default defineConfig({
  testDir: "tests/visual",
  testMatch: /.*\.pw\.ts$/,
  outputDir: "tests/visual/results",
  snapshotPathTemplate: "tests/visual/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "tests/visual/results/report.json" }]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" } },
  use: { baseURL: "http://127.0.0.1:6007", trace: "off", screenshot: "off", video: "off" },
  webServer: {
    command: "node scripts/engineering/serve-static.mjs storybook-static 6007",
    url: "http://127.0.0.1:6007/index.json",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
