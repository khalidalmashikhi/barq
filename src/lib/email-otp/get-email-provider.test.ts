import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getEmailOtpProvider, isEmailOtpConfigured } = await import("./get-email-provider");
const { EmailDeliveryUnavailableError } = await import("./providers/disabled-email-provider");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getEmailOtpProvider — factory (INERT by default)", () => {
  it("defaults to the disabled provider when EMAIL_OTP_PROVIDER is unset", () => {
    const p = getEmailOtpProvider();
    expect(p.name).toBe("disabled");
  });

  it('EMAIL_OTP_PROVIDER="disabled" -> disabled provider whose send() FAILS CLOSED', async () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "disabled");
    const p = getEmailOtpProvider();
    expect(p.name).toBe("disabled");
    await expect(p.send({ email: "a@b.com", code: "123456", type: "sign-in" })).rejects.toBeInstanceOf(
      EmailDeliveryUnavailableError
    );
  });

  it('EMAIL_OTP_PROVIDER="console" -> console provider that delivers (dev only) without throwing', async () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "console");
    vi.stubEnv("NODE_ENV", "test");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const p = getEmailOtpProvider();
    expect(p.name).toBe("console");
    await expect(p.send({ email: "a@b.com", code: "123456", type: "sign-in" })).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    // The dev log includes the code (dev terminal only) — this provider is forbidden
    // in production by env-schema + its own guard (next test).
  });

  it('console provider REFUSES to run under NODE_ENV=production (never an accidental real channel)', async () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "console");
    vi.stubEnv("NODE_ENV", "production");
    const p = getEmailOtpProvider();
    await expect(p.send({ email: "a@b.com", code: "123456", type: "sign-in" })).rejects.toThrow(/production/);
  });

  it("throws on an unknown provider name", () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "sendgrid");
    expect(() => getEmailOtpProvider()).toThrow(/unknown EMAIL_OTP_PROVIDER/);
  });

  // AUTH-EMAIL-VENDOR-1 — Resend
  it('EMAIL_OTP_PROVIDER="resend" with both credentials -> ResendEmailProvider', () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "BARQ <noreply@barq.example>");
    const p = getEmailOtpProvider();
    expect(p.name).toBe("resend");
  });

  it('EMAIL_OTP_PROVIDER="resend" without credentials -> throws (all-or-nothing)', () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "resend"); // no RESEND_API_KEY / EMAIL_FROM
    expect(() => getEmailOtpProvider()).toThrow(/requires RESEND_API_KEY and EMAIL_FROM/);
    vi.stubEnv("RESEND_API_KEY", "re_test"); // still missing EMAIL_FROM
    expect(() => getEmailOtpProvider()).toThrow(/requires RESEND_API_KEY and EMAIL_FROM/);
  });
});

describe("isEmailOtpConfigured — fail-closed UI gate", () => {
  it("is false when unset or disabled (email option not shown / inert)", () => {
    expect(isEmailOtpConfigured()).toBe(false);
    vi.stubEnv("EMAIL_OTP_PROVIDER", "disabled");
    expect(isEmailOtpConfigured()).toBe(false);
  });

  it('is true for a provider that can deliver ("console" in dev, "resend" in prod)', () => {
    vi.stubEnv("EMAIL_OTP_PROVIDER", "console");
    expect(isEmailOtpConfigured()).toBe(true);
    vi.unstubAllEnvs();
    vi.stubEnv("EMAIL_OTP_PROVIDER", "resend");
    expect(isEmailOtpConfigured()).toBe(true);
  });
});
