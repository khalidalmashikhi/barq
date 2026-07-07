import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber } from "better-auth/plugins";
import { prisma } from "@/lib/db";

// Better Auth server configuration — Engineering Sprint 2 (Auth Foundation),
// updated by the Phone OTP Schema Support sprint now that `phoneNumberVerified`
// exists on User and the phoneNumber plugin is approved for configuration.
//
// AUTHENTICATION.md §4 confirms Better Auth and states BARQ's actual
// method is phone + OTP, never email/password — emailAndPassword is
// explicitly disabled below, not left to a library default.
//
// Secrets are read from environment variables only, never hardcoded,
// per PROJECT_RULES.md §16 and SECURITY.md §8. See .env.example for the
// required variables (BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL).
//
// FLAGGED, NOT RESOLVED — a genuine technical uncertainty in this exact
// configuration, reported rather than guessed at: `signUpOnVerification
// .getTempEmail` generates a synthetic email value specifically so
// Better Auth's sign-up flow never has to collect a real one — that part
// is unambiguous and implemented below exactly as instructed. What is
// NOT confirmed from here (no network access to Better Auth's live docs
// or source) is whether the underlying adapter write requires an `email`
// column to exist on the Prisma `User` model to persist that generated
// value. Per explicit instruction, no `email` column was added to User.
// If the adapter attempts to write `email` and the column doesn't
// exist, this will fail at runtime with a Prisma "unknown argument"
// error the first time a phone number is verified — that would be the
// signal this needs to come back for a decision, not something to
// silently patch by adding the column afterward.
//
// VERIFICATION NOTE (carried over from Sprint 2 and 3): this
// configuration is written from Better Auth's documented API (training
// knowledge), not yet typechecked or run against the actual installed
// package in this sandbox — verify in an environment with real network
// access and installed dependencies before relying on it.

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

  plugins: [
    phoneNumber({
async sendOTP({ phoneNumber, code }) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[BARQ OTP] ${phoneNumber}: ${code}`);
    return;
  }

  throw new Error("SMS provider is not configured yet.");
},
      // Auto-create a User on first successful OTP verification, per
      // DOMAIN_MODEL.md's User lifecycle ("Created (via OTP
      // verification...)") — this creates only the bare Identity `User`
      // record, never a Customer/Provider/Staff/Admin profile, per
      // DOMAIN_MODEL.md's explicit separation between Identity and those
      // profile extensions. Creating a Customer profile automatically
      // here would be a scope violation this sprint was explicitly told
      // to avoid ("Do not implement Customer profile yet").
      signUpOnVerification: {
        getTempEmail: (phoneNumber: string) => `${phoneNumber}@phone.barq.internal`,
      },
      // OTP expiry, resend policy, and rate limiting are AUTHENTICATION.md
      // §5's and §8's own stated Open Decisions — not invented here.
      // Better Auth's own defaults apply until those decisions are made
      // and translated into explicit configuration.
    }),
  ],

  session: {
    // Session lifecycle (expiration, refresh) per AUTHENTICATION.md §5 —
    // specific durations remain that document's own Open Decision #1,
    // not invented here. Better Auth's own defaults apply until that
    // decision is made and translated into explicit configuration.
  },
});

export type Auth = typeof auth;
