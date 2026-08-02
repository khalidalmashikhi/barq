import { describe, it, expect, vi, afterEach } from "vitest";

// fix(deploy): allow disabled OTP delivery in staging — regression tests for
// the staging-only "disabled" provider. Confirms it fails closed (every send
// rejects with a stable, machine-readable code) and never generates, prints,
// logs, or exposes anything — so it can never become a delivery channel or an
// auth bypass.

vi.mock("server-only", () => ({}));

const { DisabledOtpProvider, OtpDeliveryUnavailableError } = await import("./disabled-provider");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DisabledOtpProvider", () => {
  it("identifies as 'disabled'", () => {
    expect(new DisabledOtpProvider().name).toBe("disabled");
  });

  it("fails closed: send() always rejects with OtpDeliveryUnavailableError and a stable code", async () => {
    const provider = new DisabledOtpProvider();
    await expect(provider.send()).rejects.toBeInstanceOf(OtpDeliveryUnavailableError);
    await expect(provider.send()).rejects.toMatchObject({ code: "OTP_DELIVERY_UNAVAILABLE" });
  });

  it("never prints, logs, or exposes anything when a send is attempted", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = new DisabledOtpProvider();
    await expect(provider.send()).rejects.toBeInstanceOf(OtpDeliveryUnavailableError);

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("carries no OTP or secret on the thrown error — only a code and a generic message", async () => {
    const provider = new DisabledOtpProvider();
    const error = await provider.send().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OtpDeliveryUnavailableError);
    const serialized = JSON.stringify({
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    expect(serialized).toContain("OTP_DELIVERY_UNAVAILABLE");
    expect(serialized).not.toMatch(/\d{4,}/); // no code-shaped digit run
  });
});
