import { describe, it, expect, vi } from "vitest";

// Pure resolver — stub the server-only import chain so the module loads under vitest.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/customer-credential-state", () => ({ getCustomerCredentialState: vi.fn() }));
vi.mock("@/lib/auth/effective-account-type", () => ({ resolveEffectiveAccountType: vi.fn() }));

const { resolveRegistrationStep, hasRegistrationName } = await import("./registration-state");
type RegistrationSnapshot = Parameters<typeof resolveRegistrationStep>[0];

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Pure step-resolution matrix.

const base: RegistrationSnapshot = {
  effectiveType: "UNCLASSIFIED",
  declaredType: null,
  hasName: false,
  hasVerifiedPhone: true, // phone-first: verified at entry
  hasVerifiedEmail: false,
};
const snap = (o: Partial<RegistrationSnapshot>): RegistrationSnapshot => ({ ...base, ...o });

describe("resolveRegistrationStep", () => {
  it("classified/legacy/admin/staff identity is DONE (never walked through registration)", () => {
    for (const t of ["ADMIN", "STAFF", "PROVIDER", "CUSTOMER"] as const) {
      expect(resolveRegistrationStep(snap({ effectiveType: t }))).toBe("DONE");
    }
  });

  it("UNCLASSIFIED + no declared type → CHOOSE_USAGE", () => {
    expect(resolveRegistrationStep(snap({ declaredType: null }))).toBe("CHOOSE_USAGE");
  });

  it("declared but no name → COMPLETE_DETAILS", () => {
    expect(resolveRegistrationStep(snap({ declaredType: "CUSTOMER", hasName: false }))).toBe("COMPLETE_DETAILS");
    expect(resolveRegistrationStep(snap({ declaredType: "PROVIDER", hasName: false }))).toBe("COMPLETE_DETAILS");
  });

  it("declared + name but phone not verified (social-first) → COMPLETE_DETAILS", () => {
    expect(
      resolveRegistrationStep(snap({ declaredType: "CUSTOMER", hasName: true, hasVerifiedPhone: false }))
    ).toBe("COMPLETE_DETAILS");
  });

  it("declared + name + phone, email not verified → VERIFY_EMAIL", () => {
    expect(
      resolveRegistrationStep(snap({ declaredType: "CUSTOMER", hasName: true, hasVerifiedEmail: false }))
    ).toBe("VERIFY_EMAIL");
  });

  it("declared + name + phone + verified email, no profile yet → FINALIZE", () => {
    expect(
      resolveRegistrationStep(snap({ declaredType: "PROVIDER", hasName: true, hasVerifiedEmail: true }))
    ).toBe("FINALIZE");
  });

  it("a finalized profile flips effectiveType away from UNCLASSIFIED → DONE (even with declared intent set)", () => {
    expect(
      resolveRegistrationStep(snap({ effectiveType: "CUSTOMER", declaredType: "CUSTOMER", hasName: true, hasVerifiedEmail: true }))
    ).toBe("DONE");
  });
});

describe("hasRegistrationName", () => {
  it("true only for a non-empty trimmed string", () => {
    expect(hasRegistrationName("Sara")).toBe(true);
    expect(hasRegistrationName("  x ")).toBe(true);
    expect(hasRegistrationName("   ")).toBe(false);
    expect(hasRegistrationName("")).toBe(false);
    expect(hasRegistrationName(null)).toBe(false);
    expect(hasRegistrationName(undefined)).toBe(false);
  });
});
