import type { Config } from "tailwindcss";

// Design tokens.
//
// Brand Identity Reset (2026-07) — Phase 1: Brand Foundation. Colors
// below were replaced from the original purple/teal/amber palette to
// match the new official logo (public/Barqlogo.png), which contains no
// purple at all. Every value was extracted via pixel-sampling the real
// PNG (Node + sharp: clustered every opaque, non-white pixel into color
// families, then computed the pixel-count-weighted average per family)
// — not eyedropped or guessed. See docs/10-design/DESIGN_SYSTEM.md for
// the full extraction methodology, sample counts, and WCAG contrast
// validation this palette is based on.
//
// Typography (fontFamily below) is UNCHANGED by the brand reset — IBM
// Plex Sans / IBM Plex Sans Arabic already paired well with the new
// mark's geometric quality, confirmed during the brand analysis, no
// replacement needed.

const config: Config = {
  darkMode: "class", // structural readiness only — no toggle implemented yet,
  // consistent with DESIGN_SYSTEM.md's "Dark Mode Readiness... not a V1
  // commitment." This makes the token system capable of a dark variant
  // later without a rework, not a claim that dark mode is finished.
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Navy — extracted from the logo's calligraphy stroke/wordmark
        // (114,189 sampled px, the largest region in the mark).
        // 10.45:1 contrast on white — AAA, safe for text and solid
        // buttons.
        primary: {
          DEFAULT: "#094367",
          foreground: "#FFFFFF",
        },
        // Bright Teal (DEFAULT) — the logo's facet/flight-arc color;
        // decorative use only, 2.39:1 on white — FAILS AA as text or as
        // a solid button fill with white text. "700" is a second,
        // genuinely distinct dark teal ALSO extracted from the logo
        // (not synthesized) — 5.37:1, AA-safe for text/buttons.
        secondary: {
          DEFAULT: "#1ABBAF",
          foreground: "#FFFFFF",
          700: "#077588",
        },
        // Orange (DEFAULT) — the logo's diamond/airplane accent color;
        // decorative use only, 2.75:1 on white in either direction —
        // FAILS AA. foreground is Navy (best available pairing, 3.80:1
        // — AA for large text/UI components, not small body text).
        // "700" is a darkened derivative (not present in the source
        // logo) specifically for buttons/functional text needing full
        // AA — 4.65:1 with white text.
        accent: {
          DEFAULT: "#F27B2E",
          foreground: "#094367",
          700: "#B55C22",
        },
        // Sand — extracted from the logo's tan/gold facet. Decorative/
        // tint use only (2.34:1 on white — fails AA in both
        // directions); safe as a low-opacity background tint with Navy
        // text on top (the existing bg-*/15-style pattern already used
        // for icon chips throughout this app).
        muted: {
          DEFAULT: "#D4A05E",
          foreground: "#094367",
        },
        background: "#F7F8FA",
        card: "#FFFFFF",
        foreground: "#0F172A",
        border: "rgba(9, 67, 103, 0.08)",
        success: "#16A34A",
        danger: "#DC2626",
        // New semantic colors (Phase 1) — deliberately NOT derived from
        // the logo's hues: warning/info are utility colors with their
        // own strong conventional meaning, same reasoning success/danger
        // already followed.
        warning: "#F2A61E",
        info: "#1E5265",
      },
      fontFamily: {
        // IBM Plex Sans Arabic chosen over Tajawal: IBM Plex ships a
        // genuinely matched Latin companion (IBM Plex Sans) designed by
        // the same foundry as one family, giving Arabic and English a
        // consistent voice at the same weight/rhythm — Tajawal's usual
        // Latin pairings are separate, unrelated typefaces. This is the
        // deliberate choice the brief's "Tajawal or IBM Plex Sans
        // Arabic" either/or resolves to, stated here so it isn't
        // silently ambiguous in the codebase.
        sans: ["var(--font-plex-arabic)", "var(--font-plex-latin)", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      spacing: {
        // Tailwind's default scale is already 4px-based; every value
        // used in components below is a multiple of 2 (8px), satisfying
        // the brief's 8px system without overriding Tailwind's scale
        // wholesale — a deliberate convention, not an accident.
      },
    },
  },
  plugins: [],
};

export default config;
