import { describe, it, expect, vi } from "vitest";

// AUTH-EMAIL-OTP-1 — regression guard for the "email OTP is SIGN-IN ONLY" decision.
//
// This asserts the real, constructed Better Auth `auth` instance carries the
// email-otp plugin with `disableSignUp: true`. Better Auth's plugin object exposes
// its input options (node_modules/better-auth/dist/plugins/email-otp/index.mjs
// returns `{ id: "email-otp", ..., options }`), so flipping the flag back to false
// in src/lib/auth/server.ts would fail this test.
//
// The RUNTIME consequence of the flag is Better Auth's own, verified from the
// installed package (routes.mjs): with disableSignUp, /sign-in/email-otp throws
// INVALID_OTP for an unknown email instead of taking the createUser branch (that
// branch runs only when !disableSignUp), and /email-otp/send-verification-otp
// returns { success: true } without sending for an unknown email — so an unknown
// email creates NO AuthUser / User / Customer and leaks no account existence. We do
// not re-boot Better Auth to re-test its library internals here; we pin OUR config.

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

  it("configures the email-otp plugin with disableSignUp: true (no email-first sign-up)", () => {
    expect(emailOtp?.options?.disableSignUp).toBe(true);
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
