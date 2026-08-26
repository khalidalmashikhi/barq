import { describe, it, expect, vi } from "vitest";

// AUTH-DUAL-IDENTITY-1 — regression guard for the email-OTP plugin config on the
// real, constructed Better Auth `auth` instance (its plugin object exposes its
// input `options`). Pins that email OTP is now a first-class SIGNUP method
// (disableSignUp: false, superseding AUTH-EMAIL-OTP-1's sign-in-only stance),
// change-email linking stays enabled, storeOTP stays hashed, and the phone plugin
// is untouched. We pin OUR config, not Better Auth's internals.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

// betterAuth() reads these at construction; set before importing the module.
vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_URL", "http://localhost:3000");

const { auth } = await import("./server");

type PluginShape = { id: string; options?: Record<string, unknown> };
const plugins = (auth.options.plugins ?? []) as PluginShape[];
const emailOtp = plugins.find((p) => p.id === "email-otp");
const phone = plugins.find((p) => p.id === "phone-number");

describe("AUTH-EMAIL-OTP-1 — email OTP sign-in only", () => {
  it("registers the email-otp plugin", () => {
    expect(emailOtp).toBeDefined();
  });

  it("AUTH-DUAL-IDENTITY-1 — email OTP is a first-class signup method (disableSignUp: false)", () => {
    // Email-first signup is now supported (mirrors phone OTP). An unknown email that
    // verifies creates one AuthUser -> one BARQ User + Customer (Case C/D), no
    // Provider/Admin privilege, no merge; convergence is by explicit linking.
    expect(emailOtp?.options?.disableSignUp).toBe(false);
  });

  it("AUTH-EMAIL-LINK-1 — enables OTP change-email for authenticated linking (verifyCurrentEmail false)", () => {
    const changeEmail = emailOtp?.options?.changeEmail as { enabled?: boolean; verifyCurrentEmail?: boolean } | undefined;
    expect(changeEmail?.enabled).toBe(true);
    expect(changeEmail?.verifyCurrentEmail).toBe(false);
  });

  it("keeps storeOTP hashed (email codes are not stored in plaintext)", () => {
    expect(emailOtp?.options?.storeOTP).toBe("hashed");
  });

  it("leaves the phone-number plugin present (Phone OTP unchanged)", () => {
    expect(phone).toBeDefined();
    // Phone OTP never set disableSignUp — its signUpOnVerification auto-create stays.
    expect((phone?.options as Record<string, unknown> | undefined)?.disableSignUp).toBeUndefined();
  });
});
