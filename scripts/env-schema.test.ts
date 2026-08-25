import { describe, it, expect, vi, afterEach } from "vitest";
import { envSchema } from "./env-schema";

// Phase D.3 (Production Hardening) — regression tests for the two
// production-only rules added this phase: NEXT_PUBLIC_APP_URL becomes
// required, and BETTER_AUTH_SECRET must be at least 32 characters, but
// ONLY when NODE_ENV=production — verifying both that the new rules
// actually fire in production, and that they stay dormant everywhere
// else (the exact property that keeps CI, which never sets NODE_ENV,
// unaffected — see env-schema.ts's own comment).
//
// vi.stubEnv (not a direct `process.env.NODE_ENV = ...` assignment) —
// @types/node types NODE_ENV as a readonly property of ProcessEnv, so
// a direct assignment fails `tsc --noEmit`; vi.stubEnv is Vitest's own
// supported mechanism for exactly this, and vi.unstubAllEnvs() in
// afterEach restores the real value after every test.

const validBase = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/barq",
  BETTER_AUTH_SECRET: "short-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("envSchema — non-production", () => {
  it("allows a short BETTER_AUTH_SECRET and a missing NEXT_PUBLIC_APP_URL when NODE_ENV is not production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});

describe("envSchema — Google social login (Gate 3)", () => {
  it("accepts neither Google credential set (Google simply unavailable)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(envSchema.safeParse(validBase).success).toBe(true);
  });

  it("accepts BOTH Google credentials set", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(result.success).toBe(true);
  });

  it("REJECTS a partial config: client id without secret", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, GOOGLE_CLIENT_ID: "id" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "GOOGLE_CLIENT_SECRET")).toBe(true);
    }
  });

  it("REJECTS a partial config: secret without client id", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, GOOGLE_CLIENT_SECRET: "secret" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "GOOGLE_CLIENT_ID")).toBe(true);
    }
  });
});

describe("envSchema — production", () => {
  it("fails when NEXT_PUBLIC_APP_URL is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({ ...validBase, BETTER_AUTH_SECRET: "a".repeat(32) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "NEXT_PUBLIC_APP_URL")).toBe(true);
    }
  });

  it("fails when BETTER_AUTH_SECRET is shorter than 32 characters", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      NEXT_PUBLIC_APP_URL: "https://barq.example",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "BETTER_AUTH_SECRET")).toBe(true);
    }
  });

  it("passes when all production requirements are satisfied", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
      CRON_SECRET: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });
});

// Phase 5.1 (Production Readiness) — CRON_SECRET authenticates Vercel
// Cron's request to /api/cron/expire-stale-bookings; required in
// production only, same shape as NEXT_PUBLIC_APP_URL's own rule above.

describe("envSchema — CRON_SECRET", () => {
  it("allows a missing CRON_SECRET outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("fails in production when CRON_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "CRON_SECRET")).toBe(true);
    }
  });
});

// Phase D.4 (Production OTP Integration) — regression tests for the two
// OTP-related rules added this phase: OTP_PROVIDER defaults to
// "console" and must not remain "console" in production (that provider
// refuses to run in production anyway — this just fails fast at
// startup instead of at the first login attempt); and OTP_PROVIDER=twilio
// requires its three credential variables in every environment.

describe("envSchema — OTP provider", () => {
  it("defaults OTP_PROVIDER to console and allows it outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OTP_PROVIDER).toBe("console");
    }
  });

  it("fails in production when OTP_PROVIDER resolves to console (the default)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "OTP_PROVIDER")).toBe(true);
    }
  });

  it("fails when OTP_PROVIDER=twilio is missing its credentials, in any environment", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, OTP_PROVIDER: "twilio" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path[0]);
      expect(paths).toContain("TWILIO_ACCOUNT_SID");
      expect(paths).toContain("TWILIO_AUTH_TOKEN");
      expect(paths).toContain("TWILIO_FROM_NUMBER");
    }
  });

  it("passes when OTP_PROVIDER=twilio has all its credentials, outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({
      ...validBase,
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
    });
    expect(result.success).toBe(true);
  });
});

// fix(db): use transaction pooling for Vercel runtime — DIRECT_URL (the
// Prisma datasource `directUrl`, session pooler) is consumed by Prisma's
// migration engine, never read in src/, and Prisma itself hard-fails
// validate/migrate if it is missing. It therefore stays OPTIONAL in this
// schema (so the CI production-shape check keeps passing without it); these
// tests lock that contract — accepted when present, not required when absent.
describe("envSchema — DIRECT_URL (Prisma directUrl)", () => {
  it("is optional: production validation still passes without DIRECT_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
      CRON_SECRET: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("is accepted when present", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({
      ...validBase,
      DIRECT_URL: "postgresql://user:pass@localhost:5432/barq",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DIRECT_URL).toBe("postgresql://user:pass@localhost:5432/barq");
    }
  });
});

// fix(deploy): allow disabled OTP delivery in staging — regression tests for
// APP_ENV and the staging-only OTP_PROVIDER=disabled mode. Confirms disabled
// is allowed ONLY under APP_ENV=staging, rejected for APP_ENV=production and
// when APP_ENV is unset, and that APP_ENV=production forces a real provider.

describe("envSchema — APP_ENV / disabled OTP (staging escape hatch)", () => {
  const prodBase = {
    ...validBase,
    BETTER_AUTH_SECRET: "a".repeat(32),
    NEXT_PUBLIC_APP_URL: "https://staging.barq.example",
    CRON_SECRET: "a".repeat(32),
  };

  it("allows OTP_PROVIDER=disabled when APP_ENV=staging (NODE_ENV=production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({ ...prodBase, APP_ENV: "staging", OTP_PROVIDER: "disabled" });
    expect(result.success).toBe(true);
  });

  it("rejects OTP_PROVIDER=disabled when APP_ENV is unset", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, OTP_PROVIDER: "disabled" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "OTP_PROVIDER")).toBe(true);
    }
  });

  it("rejects OTP_PROVIDER=disabled when APP_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({ ...prodBase, APP_ENV: "production", OTP_PROVIDER: "disabled" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "OTP_PROVIDER")).toBe(true);
    }
  });

  it("rejects OTP_PROVIDER=console when APP_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({ ...prodBase, APP_ENV: "production", OTP_PROVIDER: "console" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "OTP_PROVIDER")).toBe(true);
    }
  });

  it("requires the Twilio credentials for APP_ENV=production with OTP_PROVIDER=twilio, and passes when present", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...prodBase,
      NEXT_PUBLIC_APP_URL: "https://barq.example",
      APP_ENV: "production",
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
    });
    expect(result.success).toBe(true);
  });
});

// Phase 2.22A (Provider Selection Architecture Refinement) — regression
// tests for PAYMENT_PROVIDER, mirroring the OTP_PROVIDER block above
// exactly: defaults to "NONE" and is allowed everywhere, and
// PAYMENT_PROVIDER=STRIPE requires its two credential variables in
// every environment (no production-only gate, same reasoning as
// OTP_PROVIDER=twilio's own credential check — there is no meaningful
// "Stripe selected but no credentials" state).

describe("envSchema — Payment provider", () => {
  it("defaults PAYMENT_PROVIDER to NONE and allows it outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PAYMENT_PROVIDER).toBe("NONE");
    }
  });

  it("does not force Stripe credentials for a deployment with PAYMENT_PROVIDER=NONE (the default), even in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
      CRON_SECRET: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("fails when PAYMENT_PROVIDER=STRIPE is missing its credentials, in any environment", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, PAYMENT_PROVIDER: "STRIPE" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path[0]);
      expect(paths).toContain("STRIPE_SECRET_KEY");
      expect(paths).toContain("STRIPE_WEBHOOK_SECRET");
    }
  });

  it("passes when PAYMENT_PROVIDER=STRIPE has both its credentials, outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({
      ...validBase,
      PAYMENT_PROVIDER: "STRIPE",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_dummy",
    });
    expect(result.success).toBe(true);
  });
});

// AUTH-CUSTOMER-EMAIL-OTP — EMAIL_OTP_PROVIDER defaults to "disabled" (email OTP
// inert; safe in production) and, like OTP_PROVIDER, must not be "console" in
// production (that dev-only provider refuses to run there anyway — fail fast at
// startup instead of at the first email sign-in attempt).
describe("envSchema — EMAIL_OTP_PROVIDER (email OTP, inert by default)", () => {
  it('defaults to "disabled" when unset', () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.EMAIL_OTP_PROVIDER).toBe("disabled");
    }
  });

  it('allows "console" outside production', () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, EMAIL_OTP_PROVIDER: "console" });
    expect(result.success).toBe(true);
  });

  it('allows "disabled" in production (email OTP simply stays inert)', () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
      CRON_SECRET: "a".repeat(32),
      EMAIL_OTP_PROVIDER: "disabled",
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS "console" in production', () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = envSchema.safeParse({
      ...validBase,
      BETTER_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://barq.example",
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+14155238886",
      CRON_SECRET: "a".repeat(32),
      EMAIL_OTP_PROVIDER: "console",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "EMAIL_OTP_PROVIDER")).toBe(true);
    }
  });

  it("rejects an unknown provider value", () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = envSchema.safeParse({ ...validBase, EMAIL_OTP_PROVIDER: "resend" });
    expect(result.success).toBe(false);
  });
});
