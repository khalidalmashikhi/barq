import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/db";

// Better Auth server configuration — Engineering Sprint 2 (Auth Foundation).
//
// SCOPE OF THIS SPRINT: core persistence wiring only. No sign-in method
// (phone OTP or otherwise) is enabled here — per explicit instruction,
// implementing the OTP flow itself is out of scope for this sprint. This
// file proves that Better Auth can read/write through BARQ's existing
// Prisma client and schema (User/Session/Account/Verification models,
// per prisma/schema.prisma) without introducing a parallel database
// connection or a competing ORM instance.
//
// AUTHENTICATION.md §4 confirms Better Auth and states BARQ's actual
// method is phone + OTP, never email/password — emailAndPassword is
// explicitly disabled below, not left to a library default.
//
// Secrets are read from environment variables only, never hardcoded,
// per PROJECT_RULES.md §16 and SECURITY.md §8. See .env.example for the
// required variables (BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL).
//
// VERIFICATION NOTE: this configuration is written from Better Auth's
// documented API (training knowledge) and has not been typechecked
// against the actual installed package in this sandbox (no network
// access here to install it — see DEVELOPMENT_LOG.md Entries 039-040).
// Run `npm run typecheck` against this file in an environment where
// better-auth is actually installed before relying on it.

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  // BARQ never uses email/password — phone + OTP only, per
  // AUTHENTICATION.md §4. Disabled explicitly rather than left to
  // whatever Better Auth's own default happens to be.
  emailAndPassword: {
    enabled: false,
  },

  // Phone/OTP plugin intentionally NOT configured in this sprint.
  // AUTHENTICATION.md §4's exact OTP parameters (expiry window, resend
  // policy, rate limiting per SECURITY.md §8) still need to be translated
  // into plugin configuration in a dedicated follow-up sprint — adding
  // it here without that translation would mean guessing at values this
  // project has deliberately left as Open Decisions rather than invented.
  plugins: [],

  session: {
    // Session lifecycle (expiration, refresh) per AUTHENTICATION.md §5 —
    // specific durations remain that document's own Open Decision #1,
    // not invented here. Better Auth's own defaults apply until that
    // decision is made and translated into explicit configuration.
  },
});

export type Auth = typeof auth;
