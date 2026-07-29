import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { checkEnvironmentHealth } = await import("./check-environment-health");

const REQUIRED_BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/barq",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkEnvironmentHealth", () => {
  it("returns \"ok\" when every required variable is present and valid", () => {
    for (const [key, value] of Object.entries(REQUIRED_BASE)) vi.stubEnv(key, value);
    expect(checkEnvironmentHealth()).toBe("ok");
  });

  it("returns \"incomplete\" when a required variable is missing", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", REQUIRED_BASE.BETTER_AUTH_SECRET);
    vi.stubEnv("BETTER_AUTH_URL", REQUIRED_BASE.BETTER_AUTH_URL);
    vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_URL", REQUIRED_BASE.NEXT_PUBLIC_BETTER_AUTH_URL);
    expect(checkEnvironmentHealth()).toBe("incomplete");
  });

  it("returns \"incomplete\" in production when NEXT_PUBLIC_APP_URL is missing", () => {
    for (const [key, value] of Object.entries(REQUIRED_BASE)) vi.stubEnv(key, value);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "a-real-secret");
    vi.stubEnv("OTP_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token123");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+14155238886");

    expect(checkEnvironmentHealth()).toBe("incomplete");
  });
});
