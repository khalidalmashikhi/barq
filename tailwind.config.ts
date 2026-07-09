import type { Config } from "tailwindcss";

// Design tokens — sourced directly from the BARQ visual identity brief.
// Colors and typography below are exact values from that brief, not
// invented alternatives, per the frontend-design skill's guidance to
// follow a brief's pinned-down direction exactly.
//
// This also resolves DESIGN_SYSTEM.md's own previously-open decisions
// (§22 Open Decision #1, specific color palette; #2, specific typefaces)
// — should be reflected back into that document as a follow-up, not
// silently left inconsistent with what ships here.

const config: Config = {
  darkMode: "class", // structural readiness only — no toggle implemented yet,
  // consistent with DESIGN_SYSTEM.md's "Dark Mode Readiness... not a V1
  // commitment." This makes the token system capable of a dark variant
  // later without a rework, not a claim that dark mode is finished.
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#4F2D8C",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#2C7A7B",
          foreground: "#FFFFFF",
        },
        accent: {
          DEFAULT: "#F5B942",
          foreground: "#1E1B2E",
        },
        background: "#F7F8FA",
        card: "#FFFFFF",
        foreground: "#0F172A",
        border: "rgba(15, 23, 42, 0.08)",
        success: "#16A34A",
        danger: "#DC2626",
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
