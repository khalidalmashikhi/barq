import path from "node:path";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import appTailwind from "../tailwind.config.ts";

const root = path.resolve(import.meta.dirname, "..");
/** The app's Tailwind config, unchanged, plus `design-lab/` as a content source — Storybook only. */
const labTailwind = { ...appTailwind, content: [path.join(root, "src/**/*.{ts,tsx}"), path.join(root, "design-lab/**/*.{ts,tsx}")] };

// BARQ design lab (2026-10-24) — Storybook is a design workbench only: it renders presentational
// components and composed screen prototypes from `design-lab/`, plus a few CURRENT app components for
// before/after. Nothing here is imported by the application, so the Next.js build and its client
// bundle are unchanged.
//
// Tailwind runs here with the app config + `design-lab/` as an extra content source, so the lab's
// classes never reach the app's own CSS (the app keeps scanning `src/**` alone).
// Telemetry is off here AND on the CLI (`--disable-telemetry` in the package scripts); the dev server
// binds to 127.0.0.1 only (`--host 127.0.0.1`).

const config: StorybookConfig = {
  stories: ["../design-lab/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  staticDirs: [],
  async viteFinal(viteConfig) {
    viteConfig.css = {
      ...viteConfig.css,
      postcss: { plugins: [tailwindcss(labTailwind), autoprefixer()] },
    };
    viteConfig.server = { ...viteConfig.server, host: "127.0.0.1" };
    return viteConfig;
  },
};

export default config;
