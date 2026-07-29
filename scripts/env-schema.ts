import { z } from "zod";

// Environment schema — extracted from validate-env.ts, Phase D.3
// (Production Hardening), specifically so this schema is unit-testable
// in isolation (scripts/env-schema.test.ts) without invoking
// validate-env.ts's own side effects (reading .env from disk, calling
// process.exit()). validate-env.ts imports and uses this exact schema
// — no logic is duplicated between the two files.
//
// PRODUCTION-ONLY CHECKS, SAFE FOR CI: the two extra rules in
// .superRefine() below only activate when
// `process.env.NODE_ENV === "production"` at the moment this schema is
// evaluated — npm does not set NODE_ENV for lifecycle scripts on its
// own, and this repo's CI workflow (.github/workflows/ci.yml) never
// sets it either, so `npm run build` in CI still validates with
// NODE_ENV unset and these two rules stay dormant. A real production
// deployment's own environment is expected to set NODE_ENV=production
// ahead of running validate-env — standard practice for Node hosting —
// which is what actually activates these checks where they matter.

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "required — ADR-0006 (PostgreSQL via Prisma)"),
    BETTER_AUTH_SECRET: z.string().min(1, "required — AUTHENTICATION.md §4 (Better Auth)"),
    BETTER_AUTH_URL: z.string().url("must be a valid URL — Better Auth server base URL"),
    NEXT_PUBLIC_BETTER_AUTH_URL: z.string().url("must be a valid URL — Better Auth browser client base URL"),
    NEXT_PUBLIC_APP_URL: z.string().url("must be a valid URL if set").optional(),
    // Phase D.4 (Production OTP Integration) — see src/lib/otp/ for the
    // provider abstraction these select/configure.
    OTP_PROVIDER: z.enum(["console", "twilio"]).optional().default("console"),
    OTP_CHANNEL: z.enum(["sms", "whatsapp"]).optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    // Phase 2.22A (Provider Selection Architecture Refinement) — mirrors
    // OTP_PROVIDER's own shape exactly. Selects the vendor
    // get-payment-gateway-provider.ts/get-payment-webhook-adapter.ts/
    // get-payment-webhook-verifier.ts each resolve to when their own
    // key argument is omitted (see each factory's own comment).
    PAYMENT_PROVIDER: z.enum(["NONE", "STRIPE"]).optional().default("NONE"),
    // Phase 2.22 (First Payment Provider) — see src/lib/payments/gateway/
    // providers/stripe-payment-gateway-provider.ts and
    // src/lib/payments/webhooks/security/providers/
    // stripe-payment-webhook-verifier.ts. Conditionally required below,
    // the same pattern as TWILIO_* — never forced for a deployment that
    // isn't using Stripe (PAYMENT_PROVIDER=NONE, the default).
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    // Phase 5.1 (Production Readiness) — authenticates Vercel Cron's
    // request to /api/cron/expire-stale-bookings (see vercel.json).
    CRON_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // OTP_PROVIDER=twilio requires its credentials in every environment
    // (not just production) — there is no meaningful "twilio selected
    // but no credentials" state, in dev or prod.
    if (env.OTP_PROVIDER === "twilio") {
      if (!env.TWILIO_ACCOUNT_SID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TWILIO_ACCOUNT_SID"],
          message: "required when OTP_PROVIDER=twilio",
        });
      }
      if (!env.TWILIO_AUTH_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TWILIO_AUTH_TOKEN"],
          message: "required when OTP_PROVIDER=twilio",
        });
      }
      if (!env.TWILIO_FROM_NUMBER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TWILIO_FROM_NUMBER"],
          message: "required when OTP_PROVIDER=twilio",
        });
      }
    }

    // PAYMENT_PROVIDER=STRIPE requires its credentials in every
    // environment (not just production), same reasoning as OTP_PROVIDER
    // above — there is no meaningful "Stripe selected but no
    // credentials" state.
    if (env.PAYMENT_PROVIDER === "STRIPE") {
      if (!env.STRIPE_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["STRIPE_SECRET_KEY"],
          message: "required when PAYMENT_PROVIDER=STRIPE",
        });
      }
      if (!env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["STRIPE_WEBHOOK_SECRET"],
          message: "required when PAYMENT_PROVIDER=STRIPE",
        });
      }
    }

    if (process.env.NODE_ENV !== "production") return;

    if (!env.NEXT_PUBLIC_APP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXT_PUBLIC_APP_URL"],
        message:
          "required in production — without it, metadataBase (src/app/layout.tsx) silently falls back to http://localhost:3000, breaking every canonical/hreflang/Open Graph URL in production. Optional only for local development.",
      });
    }

    if (env.BETTER_AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message:
          "must be at least 32 characters in production — a short value (e.g. one copied from a local .env or CI fixture) weakens Better Auth's session signing. Generate a real, random secret for production (e.g. `openssl rand -base64 32`).",
      });
    }

    if (env.OTP_PROVIDER === "console") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OTP_PROVIDER"],
        message:
          "must not be \"console\" in production — that provider only prints codes to the server terminal (src/lib/otp/providers/console-provider.ts) and itself refuses to run when NODE_ENV=production, meaning no OTP would ever be delivered. Set OTP_PROVIDER=twilio (with its credentials) or another real provider before deploying.",
      });
    }

    if (!env.CRON_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message:
          "required in production — without it, /api/cron/expire-stale-bookings (src/app/api/cron/expire-stale-bookings/route.ts) would reject every request, including Vercel Cron's own scheduled trigger (vercel.json), so stale PENDING_PROVIDER bookings would never expire.",
      });
    }
  });
