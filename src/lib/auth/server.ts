import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber, emailOTP } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { buildGoogleSocialProvider, BARQ_ACCOUNT_LINKING } from "./social-config";
import { getOtpProvider } from "@/lib/otp/get-otp-provider";
import { OtpDeliveryUnavailableError } from "@/lib/otp/providers/disabled-provider";
import { getOtpConfig } from "@/lib/otp/otp-config";
import { checkResendCooldown } from "@/lib/otp/check-resend-cooldown";
import { checkDailySendLimit } from "@/lib/otp/check-daily-send-limit";
import { normalizeInternationalPhone } from "@/lib/phone/normalize-international-phone";
import { resolveClientIp, hmacRateLimitKey } from "@/lib/rate-limit/client-ip";
import { consumeRateLimit, sweepExpiredRateLimits } from "@/lib/rate-limit/durable-rate-limiter";
import {
  getOtpSendIpRateLimit,
  getOtpSendPhoneRateLimit,
  getOtpVerifyIpRateLimit,
  otpSendIpKey,
  otpSendPhoneKey,
  otpVerifyIpKey,
} from "@/lib/otp/otp-rate-limit-config";
import {
  logOtpRequested,
  logResendRejected,
  logDailyLimitRejected,
  logOtpSent,
  logOtpSendFailed,
  logVerifyOutcome,
} from "@/lib/otp/audit";
// AUTH-CUSTOMER-EMAIL-OTP — email OTP delivery + anti-abuse, mirroring the phone
// OTP infrastructure above. INERT by default (getEmailOtpProvider fails closed
// unless EMAIL_OTP_PROVIDER is configured).
import { getEmailOtpProvider } from "@/lib/email-otp/get-email-provider";
import { EmailDeliveryUnavailableError } from "@/lib/email-otp/providers/disabled-email-provider";
import { getEmailOtpConfig } from "@/lib/email-otp/email-otp-config";
import { normalizeEmail } from "@/lib/email-otp/normalize-email";
import {
  getEmailOtpSendIpRateLimit,
  getEmailOtpSendEmailRateLimit,
  getEmailOtpVerifyIpRateLimit,
  emailOtpSendIpKey,
  emailOtpSendEmailKey,
  emailOtpSendCooldownKey,
  emailOtpSendDailyKey,
  emailOtpVerifyIpKey,
} from "@/lib/email-otp/email-otp-rate-limit-config";
import {
  logEmailOtpRequested,
  logEmailOtpResendRejected,
  logEmailOtpDailyLimitRejected,
  logEmailOtpSent,
  logEmailOtpSendFailed,
  logEmailOtpVerifyOutcome,
} from "@/lib/email-otp/audit";

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

// Generic 429 body for the durable limiters (P1) — deliberately exposes NO
// counter value, key, IP, phone, or store detail. Reuses the existing
// TOO_MANY_REQUESTS code so web/iOS clients need no contract change.
const TOO_MANY_REQUESTS_MESSAGE = "Too many requests. Please try again later.";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  // Phase 5.2 (Production Hardening) — previously unset, meaning
  // origin/CSRF checking relied entirely on Better Auth's weaker
  // implicit baseURL-only mode. Explicit allowlist of every real origin
  // this app is actually served from; .filter(Boolean) drops
  // NEXT_PUBLIC_APP_URL when it's unset (optional outside production —
  // see scripts/env-schema.ts). Additive safety only: does not change
  // behavior for any legitimate request from an origin already implied
  // by baseURL.
  trustedOrigins: [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL].filter(
    (origin): origin is string => Boolean(origin)
  ),

  // Production Hardening — cookie flags verified against the actual
  // installed Better Auth version (node_modules/better-auth/dist/
  // cookies/index.mjs's createCookieGetter/createCookie), not assumed:
  //
  //   - httpOnly: true — hardcoded unconditionally by the library
  //     itself (not derived from any option below). Already correct;
  //     nothing to configure.
  //   - sameSite: "lax" — the library's own unconditional default.
  //     Deliberately left as-is rather than tightened to "strict":
  //     BARQ's sign-in flow is a full-page redirect after OTP
  //     verification (no popup/iframe), which "lax" already protects
  //     correctly, and "strict" would additionally drop the session
  //     cookie on some cross-site-referred top-level navigations (e.g.
  //     a shared booking link opened from another site) with no
  //     security benefit this app actually needs.
  //   - secure: computed by the library as `useSecureCookies ??
  //     (baseURL starts with "https://" ? true : isProduction)` — so a
  //     correctly configured production deploy (BETTER_AUTH_URL
  //     starting with https://) already gets secure:true today WITHOUT
  //     this block. Made explicit anyway, tied to NODE_ENV (the same
  //     production gate every other check in this codebase already
  //     uses — CSP in next.config.ts, OTP_PROVIDER in env-schema.ts)
  //     rather than to the exact string shape of BETTER_AUTH_URL: this
  //     is strictly safer for a misconfigured deploy (BETTER_AUTH_URL
  //     accidentally left as a bare http:// origin in production would
  //     previously have silently downgraded the cookie to insecure;
  //     now it can't) and is a genuine zero-behavior-change no-op for
  //     every correctly configured environment, dev included (NODE_ENV
  //     is not "production" there either way).
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },

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

  // Social Login (Gate 3) — Google ONLY, and ONLY when both credentials are
  // configured (fail-closed via buildGoogleSocialProvider). OTP/Twilio is
  // completely unaffected; Google is an ADDITIONAL sign-in method. Apple is
  // deliberately deferred to a later gate.
  socialProviders: {
    ...buildGoogleSocialProvider(),
  },

  // Explicit, safe account linking (see social-config.ts). trustedProviders is
  // empty and allowDifferentEmails/updateUserInfoOnLink are false, so a matching
  // email/name is NEVER treated as authority and BARQ's profile is never
  // overwritten — authenticated linkSocial (Settings) is the intended path for
  // an existing user, and Gate-2's verified-phone reconciliation stays separate.
  account: {
    accountLinking: BARQ_ACCOUNT_LINKING,
  },

  plugins: [
    phoneNumber({
      // Production OTP delivery — Phase D.4 (Production OTP Integration).
      // The code itself is still generated and persisted entirely by
      // Better Auth (see routes.mjs's sendPhoneNumberOTP) — this
      // callback only receives an already-generated code and hands it
      // to the configured provider (src/lib/otp/get-otp-provider.ts),
      // never generating or storing one itself. Vendor selection is a
      // config-only concern (OTP_PROVIDER); this callback never
      // branches on vendor name.
      //
      // Audit events: "OTP requested" is logged in the `hooks.before`
      // below (the request arriving is the meaningful audit event,
      // even if the resend cooldown then rejects it); "OTP sent"/
      // "OTP send failed" are logged here, since only this callback
      // knows whether the provider's send() actually resolved. The OTP
      // code itself is never included in any log line (SECURITY.md's
      // "never log sensitive data" anti-pattern; logger.ts's LogContext
      // type also structurally forbids attaching arbitrary payloads).
      //
      // Deliberately NOT swallowed on failure: rethrowing lets Better
      // Auth's own /phone-number/send-otp response surface a real error
      // to the client instead of falsely confirming "code sent" when
      // delivery failed.
      sendOTP: async ({ phoneNumber, code }: { phoneNumber: string; code: string }) => {
        try {
          await getOtpProvider().send({ phoneNumber, code });
          logOtpSent(phoneNumber);
        } catch (error) {
          logOtpSendFailed(phoneNumber, error instanceof Error ? error.message : "unknown error");
          // OTP_PROVIDER=disabled (staging-only) fails closed with this typed
          // error. Surface a stable, machine-readable code (never the OTP,
          // never a secret) so the client can show a clear localized
          // "delivery unavailable" message — see login-form.tsx. Fails
          // closed: no OTP is issued, no bypass is created.
          if (error instanceof OtpDeliveryUnavailableError) {
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "OTP_DELIVERY_UNAVAILABLE",
              message: "OTP delivery is unavailable in this environment.",
            });
          }
          throw error;
        }
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
      // Expiration and failed-attempt protection are Better Auth's own
      // built-in phoneNumber plugin behavior (confirmed by reading
      // routes.mjs's verifyPhoneNumberOTP: it already checks
      // `expiresAt < now` and tracks attempts against `allowedAttempts`,
      // invalidating the code — not the account — once exceeded). Phase
      // D.4 only makes both explicitly configurable via env vars
      // instead of leaving them as implicit plugin defaults; the
      // defaults below match Better Auth's own (300s / 3 attempts)
      // exactly, so leaving the env vars unset changes nothing.
      expiresIn: getOtpConfig().expiresInSeconds,
      allowedAttempts: getOtpConfig().maxAttempts,
    }),

    // AUTH-CUSTOMER-EMAIL-OTP — Email OTP as an ADDITIONAL customer sign-in
    // method. Phone OTP + Google are entirely unaffected. Verified against the
    // installed better-auth@1.6.23 emailOTP plugin (endpoints
    // /email-otp/send-verification-otp + /sign-in/email-otp; storeOTP option;
    // findUserByEmail on sign-in so an existing email reuses its AuthUser and a
    // new one is created only when sign-up is allowed). Identity converges on one
    // BARQ User via the existing authUserId bridge (resolveBarqUser): a new email
    // -> new AuthUser -> new User; an existing real email -> its AuthUser -> its
    // User. Email is NEVER a reconciliation key (barq-user.ts), so an email
    // identity is never silently merged into a phone identity — same posture as
    // Google. Email OTP grants NO Provider/Admin role (roles are DB profile rows).
    //
    // INERT until provisioned: sendVerificationOTP delegates to getEmailOtpProvider(),
    // which fails closed (EmailDeliveryUnavailableError -> stable 503 code) unless a
    // real email vendor is configured. Rate limiting / cooldown / daily cap /
    // normalization live in the root hooks below, mirroring the phone path.
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }: { email: string; otp: string; type: "sign-in" | "email-verification" | "forget-password" | "change-email" }) => {
        try {
          await getEmailOtpProvider().send({ email, code: otp, type });
          logEmailOtpSent(email);
        } catch (error) {
          logEmailOtpSendFailed(email, error instanceof Error ? error.message : "unknown error");
          // Fail closed with a stable, machine-readable code (never the OTP, never
          // a secret) so the client can show a localized "delivery unavailable"
          // message — mirrors the phone OtpDeliveryUnavailableError path.
          if (error instanceof EmailDeliveryUnavailableError) {
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "EMAIL_DELIVERY_UNAVAILABLE",
              message: "Email OTP delivery is unavailable in this environment.",
            });
          }
          throw error;
        }
      },
      otpLength: getEmailOtpConfig().otpLength,
      expiresIn: getEmailOtpConfig().expiresInSeconds,
      allowedAttempts: getEmailOtpConfig().maxAttempts,
      // Store the code HASHED at rest (Better Auth default is "plain"). This is an
      // improvement over the phone path's plaintext Verification.value: a DB reader
      // can no longer see live email codes. resendStrategy falls back to "rotate"
      // under hashing, which is the behavior we want (each send is a fresh code).
      storeOTP: "hashed",
      // AUTH-DUAL-IDENTITY-1 — email OTP is now a FIRST-CLASS signup method
      // (disableSignUp: false), mirroring phone OTP. An unknown email that verifies
      // creates exactly ONE fresh AuthUser (with the real, verified email) which
      // resolveBarqUser resolves to exactly ONE new BARQ User + Customer (Case C/D,
      // the phone-less-first path already used by Google) — NO Provider/Admin
      // privilege, NO merge. An existing linked email resolves the SAME AuthUser ->
      // SAME User (Case A).
      //
      // ACCEPTED TRADE-OFF (superseding AUTH-EMAIL-OTP-1's sign-in-only stance):
      // because email is never a reconciliation key, a person who already has a
      // phone/Google account and signs up fresh with a new email gets a SEPARATE
      // BARQ account — ownership equivalence cannot be proven at anonymous signup.
      // Convergence is by EXPLICIT authenticated linking (Add email / Add phone in
      // Settings), never a silent auto-merge; historical A/B recovery is a separate
      // dual-proof gate (AUTH-IDENTITY-MERGE-1). The durable send cooldown / daily
      // cap / per-IP + per-email limits in the hooks below bound the "send OTP to
      // any address" abuse surface that enabling signup reintroduces.
      //
      // Verified against better-auth@1.6.23 email-otp routes: with !disableSignUp,
      // /sign-in/email-otp createUser runs for an unknown email (one AuthUser), and
      // /email-otp/send-verification-otp sends for sign-in type (new customers get a
      // code). storeOTP stays hashed; per-code attempt cap unchanged.
      disableSignUp: false,
      // AUTH-EMAIL-LINK-1 — enable Better Auth's OTP-based change-email so an
      // AUTHENTICATED user can attach a real, verified email to their CURRENT
      // AuthUser (endpoints /email-otp/request-email-change + /email-otp/change-email,
      // both behind sensitiveSessionMiddleware). Verified against better-auth@1.6.23:
      // change-email does updateUser(currentAuthUser.id, {email, emailVerified:true})
      // on the SAME AuthUser (no new user, no re-parent), rejects a taken email, and
      // verifies the OTP atomically before mutating. verifyCurrentEmail:false because
      // phone-first users hold a synthetic UNVERIFIED @phone.barq.internal email that
      // cannot be OTP-verified — ownership is proven by the OTP sent to the NEW email.
      // BARQ wraps these in src/lib/auth/link-email.ts (auth + conflict pre-check +
      // synthetic-domain reject + rate limit + audit); the client never mutates email.
      changeEmail: {
        enabled: true,
        verifyCurrentEmail: false,
      },
    }),
  ],

  // Root-level before/after hooks — Phase D.4, extended by the P0-1
  // security gate (phone canonicalization), now INTERNATIONAL
  // (AUTH-INTERNATIONAL-PHONE-1). `hooks.before` runs on BOTH
  // /phone-number/send-otp and /phone-number/verify and, as its FIRST
  // action, canonicalizes the client-supplied phone number to one
  // authoritative E.164 form via the shared libphonenumber-js authority
  // (normalizeInternationalPhone, default region Oman so legacy bare
  // Oman input still yields the exact same +968XXXXXXXX). It then REWRITES
  // ctx.body.phoneNumber to that canonical value via the returned
  // `{ context: { body } }` — confirmed against the installed Better Auth
  // that dispatch.mjs deep-merges a before-hook's `context.body` into the
  // endpoint context (defuReplaceArrays) before the handler and the
  // after-hook run. As a result the resend cooldown, the daily send cap,
  // the plugin's Verification.identifier, Twilio delivery, the verify
  // lookup, and the resulting User identity ALL key on the same canonical
  // number: equivalent textual forms can neither multiply the per-number
  // rate limits nor fragment identity, and malformed/invalid input is
  // rejected BEFORE any code is generated or any SMS is sent.
  // (The resend-cooldown check itself is still the piece Better Auth's
  // plugin lacks; `hooks.after` logs verify outcomes — after-hooks run
  // even when the endpoint throws, error at `ctx.context.returned`.)
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // === Email OTP endpoints (AUTH-CUSTOMER-EMAIL-OTP) ===
      // Self-contained; returns before the phone block below. Mirrors the phone
      // path: authoritative email normalization (single source of truth), durable
      // cooldown + daily cap + per-IP/per-email send limits, per-IP verify limit,
      // then rewrites ctx.body.email to the canonical value so the plugin's stored
      // verification, delivery, and resolved identity all key on the same string.
      if (ctx.path === "/email-otp/send-verification-otp" || ctx.path === "/sign-in/email-otp") {
        const isEmailSend = ctx.path === "/email-otp/send-verification-otp";

        const emailParam = (ctx.body as { email?: string } | undefined)?.email;
        // Missing param: let Better Auth's own validation produce its standard error.
        if (typeof emailParam !== "string" || emailParam.trim() === "") return;

        // Authoritative canonicalization (single source of truth). Reject malformed
        // input here — before the cooldown/cap lookups and before any code is
        // generated. Never expose normalization internals; the client maps the
        // stable code to a localized message.
        const normalizedEmail = normalizeEmail(emailParam);
        if (!normalizedEmail.ok) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_EMAIL",
            message: "Enter a valid email address.",
          });
        }
        const email = normalizedEmail.email;

        const rateLimitSecret = process.env.BETTER_AUTH_SECRET ?? "";
        const ctxAny = ctx as { headers?: Headers; request?: { headers?: Headers } };
        const ipKey = hmacRateLimitKey(resolveClientIp(ctxAny.headers ?? ctxAny.request?.headers), rateLimitSecret);
        const emailKey = hmacRateLimitKey(email, rateLimitSecret);

        if (isEmailSend) {
          logEmailOtpRequested(email);
          const { resendCooldownSeconds, maxSendsPerDay } = getEmailOtpConfig();

          // Cooldown expressed as a durable 1-per-window limiter (decoupled from the
          // plugin's internal verification-identifier format, unlike the phone path).
          const cooldown = await consumeRateLimit(emailOtpSendCooldownKey(emailKey), 1, resendCooldownSeconds);
          if (!cooldown.allowed) {
            logEmailOtpResendRejected(email, cooldown.retryAfterSeconds);
            throw ctx.error("TOO_MANY_REQUESTS", {
              message: `Please wait ${cooldown.retryAfterSeconds} seconds before requesting another code.`,
            });
          }

          const daily = await consumeRateLimit(emailOtpSendDailyKey(emailKey), maxSendsPerDay, 86400);
          if (!daily.allowed) {
            logEmailOtpDailyLimitRejected(email);
            throw ctx.error("TOO_MANY_REQUESTS", {
              message: "You've reached the maximum number of verification codes for today. Please try again tomorrow.",
            });
          }

          const sendIp = getEmailOtpSendIpRateLimit();
          const ipSend = await consumeRateLimit(emailOtpSendIpKey(ipKey), sendIp.limit, sendIp.windowSeconds);
          if (!ipSend.allowed) {
            throw ctx.error("TOO_MANY_REQUESTS", { message: TOO_MANY_REQUESTS_MESSAGE });
          }

          const sendEmail = getEmailOtpSendEmailRateLimit();
          const emailSend = await consumeRateLimit(emailOtpSendEmailKey(emailKey), sendEmail.limit, sendEmail.windowSeconds);
          if (!emailSend.allowed) {
            throw ctx.error("TOO_MANY_REQUESTS", { message: TOO_MANY_REQUESTS_MESSAGE });
          }

          if (Math.random() < 0.05) void sweepExpiredRateLimits();
        } else {
          // /sign-in/email-otp — durable per-IP verify cap (brute-force protection
          // across ALL emails from one source). No per-email verify cap (would let an
          // attacker lock a victim out); per-code brute force is capped by Better Auth.
          const verifyIp = getEmailOtpVerifyIpRateLimit();
          const ipVerify = await consumeRateLimit(emailOtpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds);
          if (!ipVerify.allowed) {
            throw ctx.error("TOO_MANY_REQUESTS", { message: TOO_MANY_REQUESTS_MESSAGE });
          }
        }

        return {
          context: {
            body: { ...(ctx.body as Record<string, unknown>), email },
          },
        };
      }

      const isSendOtp = ctx.path === "/phone-number/send-otp";
      const isVerify = ctx.path === "/phone-number/verify";
      if (!isSendOtp && !isVerify) return;

      const phoneNumberParam = (ctx.body as { phoneNumber?: string } | undefined)?.phoneNumber;
      // Missing param: let Better Auth's own validation produce its standard error.
      if (typeof phoneNumberParam !== "string" || phoneNumberParam.trim() === "") return;

      // Authoritative canonicalization (single source of truth). Reject
      // malformed / invalid numbers here — before the cooldown/cap lookups, before
      // any code is generated, and before Twilio is ever called. Never expose
      // normalization internals; the client maps the stable code to a localized
      // message. Default region Oman keeps legacy bare-Oman input canonical.
      const normalized = normalizeInternationalPhone(phoneNumberParam);
      if (!normalized.ok) {
        throw new APIError("BAD_REQUEST", {
          code: "INVALID_PHONE_NUMBER",
          message: "Enter a valid mobile number.",
        });
      }
      const phone = normalized.e164;

      // Durable, cross-instance rate-limit identities (P1) — BOTH the trusted
      // client IP and the canonical +968 phone are HMAC'd with the existing
      // BETTER_AUTH_SECRET, so neither is ever stored (in auth_rate_limits) or
      // logged in the raw. Both durable limiters live in Postgres, so they hold
      // across serverless instances and cold starts (unlike the in-memory limiter
      // used for booking/review).
      const rateLimitSecret = process.env.BETTER_AUTH_SECRET ?? "";
      const ctxAny = ctx as { headers?: Headers; request?: { headers?: Headers } };
      const ipKey = hmacRateLimitKey(resolveClientIp(ctxAny.headers ?? ctxAny.request?.headers), rateLimitSecret);
      const phoneKey = hmacRateLimitKey(phone, rateLimitSecret);

      if (isSendOtp) {
        logOtpRequested(phone);

        const { resendCooldownSeconds, maxSendsPerDay } = getOtpConfig();
        const cooldown = await checkResendCooldown(phone, resendCooldownSeconds);

        if (!cooldown.allowed) {
          logResendRejected(phone, cooldown.retryAfterSeconds);
          throw ctx.error("TOO_MANY_REQUESTS", {
            message: `Please wait ${cooldown.retryAfterSeconds} seconds before requesting another code.`,
          });
        }

        // Phase 5.1 (Production Readiness) — the cooldown above only
        // paces individual resends; it does nothing to cap total daily
        // volume, the real SMS-cost abuse vector once a real delivery
        // provider is live (billed per message sent). Checked second,
        // after the cheaper cooldown check has already passed. Keyed on
        // the canonical number so formatting variants share one counter.
        const dailyLimit = await checkDailySendLimit(phone, maxSendsPerDay);

        if (!dailyLimit.allowed) {
          logDailyLimitRejected(phone, dailyLimit.sentInWindow);
          throw ctx.error("TOO_MANY_REQUESTS", {
            message: "You've reached the maximum number of verification codes for today. Please try again tomorrow.",
          });
        }

        // Durable per-IP send cap (P1) — the cross-phone control the per-phone
        // caps above could not provide — plus an additional durable per-phone send
        // cap. Both are checked AFTER the cheaper cooldown/daily-cap reads (so a
        // request they already rejected never consumes limiter budget) and BEFORE
        // any code is generated or Twilio is called (this hook runs before the
        // endpoint). Fail-closed on any store error (see durable-rate-limiter.ts).
        const sendIp = getOtpSendIpRateLimit();
        const ipSend = await consumeRateLimit(otpSendIpKey(ipKey), sendIp.limit, sendIp.windowSeconds);
        if (!ipSend.allowed) {
          throw ctx.error("TOO_MANY_REQUESTS", { message: TOO_MANY_REQUESTS_MESSAGE });
        }

        const sendPhone = getOtpSendPhoneRateLimit();
        const phoneSend = await consumeRateLimit(otpSendPhoneKey(phoneKey), sendPhone.limit, sendPhone.windowSeconds);
        if (!phoneSend.allowed) {
          throw ctx.error("TOO_MANY_REQUESTS", { message: TOO_MANY_REQUESTS_MESSAGE });
        }

        // Best-effort bounded cleanup so the table can't grow unbounded without a
        // cron — probabilistic + fire-and-forget (never blocks or fails the send).
        if (Math.random() < 0.05) void sweepExpiredRateLimits();
      }

      if (isVerify) {
        // Durable per-IP verify cap (P1) — brute-force protection across ALL
        // phones from one source, checked before Better Auth verifies the code.
        // Deliberately NO per-phone verify cap: that would let an attacker lock a
        // victim's number out. Per-code brute force is already capped by Better
        // Auth (allowedAttempts). Fail-closed on any store error.
        const verifyIp = getOtpVerifyIpRateLimit();
        const ipVerify = await consumeRateLimit(otpVerifyIpKey(ipKey), verifyIp.limit, verifyIp.windowSeconds);
        if (!ipVerify.allowed) {
          throw ctx.error("TOO_MANY_REQUESTS", { message: TOO_MANY_REQUESTS_MESSAGE });
        }
      }

      // Rewrite the body so the Better Auth endpoint (send stores / verify looks up
      // the Verification by identifier) and the after-hook all operate on the
      // canonical number. This is the one place the canonical value is injected.
      return {
        context: {
          body: { ...(ctx.body as Record<string, unknown>), phoneNumber: phone },
        },
      };
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/phone-number/verify") {
        const phoneNumberParam = (ctx.body as { phoneNumber?: string } | undefined)?.phoneNumber;
        logVerifyOutcome(phoneNumberParam, ctx.context.returned);
        return;
      }
      // AUTH-CUSTOMER-EMAIL-OTP — log the email sign-in verify outcome (masked email,
      // never the code). After-hooks run even when the endpoint threw (outcome at
      // ctx.context.returned), mirroring the phone verify logging above.
      if (ctx.path === "/sign-in/email-otp") {
        const emailParam = (ctx.body as { email?: string } | undefined)?.email;
        logEmailOtpVerifyOutcome(emailParam, ctx.context.returned);
        return;
      }
    }),
  },

  session: {
    // Session lifecycle (expiration, refresh) per AUTHENTICATION.md §5 —
    // specific durations remain that document's own Open Decision #1,
    // not a product policy invented here. Phase 5.2 (Production
    // Hardening) makes Better Auth's own current defaults (7-day
    // expiry, 1-day rolling refresh) EXPLICIT rather than implicit —
    // this is a zero-behavior-change pin, not a new policy: it protects
    // against a future Better Auth version silently changing its
    // defaults out from under this app's session duration.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});

export type Auth = typeof auth;
