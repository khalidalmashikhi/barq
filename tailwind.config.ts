import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Design tokens (colors, typography, spacing, radius) are added here
      // once resolved from DESIGN_SYSTEM.md's Open Decisions (specific
      // palette values, typefaces) — not invented ahead of that resolution.
    },
  },
  plugins: [],
};

export default config;
