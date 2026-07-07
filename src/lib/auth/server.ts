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
// RESOLVED BY ADR-0009 (previously flagged here as unresolved): the
// `signUpOnVerification.getTempEmail` value below is now written to
// `AuthUser.email`, a real column that exists specifically for this
// purpose — the earlier concern about User lacking an email column no
// longer applies, since Better Auth no longer targets BARQ's User at
// all for its own writes (see the `user.modelName` mapping below). The
// remaining open uncertainty has moved to whether that remapping itself
// is configured correctly — see the note directly above `export const
// auth` below.
//
// VERIFICATION NOTE (carried over from Sprint 2 and 3): this
// configuration is written from Better Auth's documented API (training
// knowledge), not yet typechecked or run against the actual installed
// package in this sandbox — verify in an environment with real network
// access and installed dependencies before relying on it.
//
// *** THE MOST IMPORTANT UNVERIFIED PIECE IN THIS FILE, ADR-0009 ***
// The `user.modelName: "authUser"` option below is what's supposed to
// tell Better Auth's Prisma adapter to write to the `AuthUser` Prisma
// model (Prisma Client accessor `prisma.authUser`, derived from the
// schema model name) instead of its own default assumption of a model
// literally named `User`. This is my best-effort implementation of a
// real, specific Better Auth capability I have genuine (if unverified)
// knowledge of — not a guess invented from nothing — but I cannot
// confirm the exact config key/shape is correct for the actually
// installed version without live documentation access or a real
// typecheck against the installed package, neither of which this
// sandbox has. If this key is wrong, Better Auth will most likely still
// try to write to a `prisma.user` accessor that maps to BARQ's own
// `User` model — which would either fail immediately (a clear, useful
// error) or, worse, silently succeed against the wrong table if the
// shapes coincidentally overlap enough not to throw. Watch specifically
// for which table actually receives the write during testing, not just
// whether the request succeeds.

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  // ADR-0009 — remaps Better Auth's internal "user" concept to the
  // AuthUser model, keeping it fully separate from BARQ's domain User.
  // Session/Account/Verification model names already match Better
  // Auth's own defaults exactly, so no remapping is needed for them.
  user: {
    modelName: "authUser",
  },

  // BARQ never uses email/password — phone + OTP only, per
  // AUTHENTICATION.md §4. Disabled explicitly rather than left to
  // whatever Better Auth's own default happens to be.
  emailAndPassword: {
    enabled: false,
  },

  plugins: [
    phoneNumber({
      // DEVELOPMENT-ONLY delivery: prints the OTP to the server terminal,
      // never to any client-visible response, never to production logs.
      // The code itself is generated entirely by Better Auth — this
      // callback only receives and displays it, per this sprint's
      // explicit instruction to never generate or hardcode an OTP
      // ourselves ("prefer Better Auth built-in capabilities... never
      // duplicate functionality Better Auth already provides").
      //
      // Gated to non-production so this never becomes a real logging
      // channel for a live OTP (SECURITY.md's "never log sensitive
      // data" anti-pattern) — a real SMS/WhatsApp delivery provider for
      // production is explicitly out of this sprint's scope (task said
      // "Implement development sendOTP()" only) and remains a follow-up.
      sendOTP: async ({ phoneNumber, code }: { phoneNumber: string; code: string }) => {
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            "sendOTP: no production SMS/WhatsApp delivery is configured yet. " +
              "This development-only console delivery must not run in production."
          );
        }

        // Server-terminal only — this is a console.log on the server
        // process, never part of any HTTP response body, so it cannot
        // reach the browser regardless of how this action was invoked.
        console.log(`[DEV OTP] ${phoneNumber} -> ${code}`);
      },
      // Auto-create a User on first successful OTP verification, per
      // DOMAIN_MODEL.md's User lifecycle ("Created (via OTP
      // verification...)") — this creates only the bare Identity `User`
      // record, never a Customer/Provider/Staff/Admin profile, per
      // DOMAIN_MODEL.md's explicit separation between Identity and those
      // profile extensions. Creating a Customer profile automatically
      // here would be a scope violation this sprint was explicitly told
      // to avoid ("Do not implement Customer profile yet").
      //
      // *** SEE THE modelName MAPPING NOTE ABOVE `export const auth` —
      // this User-creation mechanism now depends on that mapping being
      // correct, which remains this file's central unverified piece. ***
      signUpOnVerification: {
        getTempEmail: (phoneNumber: string) => `${phoneNumber}@phone.barq.internal`,
      },
      // OTP expiry, resend policy, and rate limiting are AUTHENTICATION.md
      // §5's and §8's own stated Open Decisions — not invented here.
      // Better Auth's built-in defaults apply until those decisions are
      // made and translated into explicit configuration, per this
      // sprint's instruction to prefer Better Auth's built-ins over any
      // custom expiration/rate-limiting logic.
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
