import { describe, it, expect } from "vitest";
import { deriveProviderActivation, type ActivationInput } from "./derive-provider-activation";

// Provider activation derivation — reflects real BR-001/BR-029 rules, never
// fabricates progress.

const base: ActivationInput = {
  providerStatus: "APPROVED",
  profileComplete: false,
  verificationRequiredTotal: 1,
  verificationRequiredApproved: 1,
  totalServicesCount: 0,
  publishedServicesCount: 0,
};

function statusOf(result: ReturnType<typeof deriveProviderActivation>, key: string) {
  return result.steps.find((s) => s.key === key)!.status;
}

describe("deriveProviderActivation", () => {
  it("new approved provider (verification done, zero services) → create first service is CURRENT", () => {
    const r = deriveProviderActivation(base);
    expect(r.providerApproved).toBe(true);
    expect(statusOf(r, "verification")).toBe("COMPLETE");
    expect(statusOf(r, "firstService")).toBe("CURRENT");
    expect(statusOf(r, "publish")).toBe("BLOCKED");
    expect(r.primaryCtaKey).toBe("firstService");
    expect(r.marketplaceReady).toBe(false);
  });

  it("incomplete verification → verification is CURRENT and later steps are BLOCKED", () => {
    const r = deriveProviderActivation({ ...base, verificationRequiredApproved: 0 });
    expect(statusOf(r, "verification")).toBe("CURRENT");
    expect(statusOf(r, "firstService")).toBe("BLOCKED");
    expect(statusOf(r, "publish")).toBe("BLOCKED");
    expect(r.primaryCtaKey).toBe("verification");
    expect(r.marketplaceReady).toBe(false);
  });

  it("has a draft service but nothing published → publish is CURRENT", () => {
    const r = deriveProviderActivation({ ...base, totalServicesCount: 1, publishedServicesCount: 0 });
    expect(statusOf(r, "firstService")).toBe("COMPLETE");
    expect(statusOf(r, "publish")).toBe("CURRENT");
    expect(r.primaryCtaKey).toBe("publish");
    expect(r.marketplaceReady).toBe(false);
  });

  it("established/ready provider (verified + published) → marketplaceReady, no primary CTA", () => {
    const r = deriveProviderActivation({ ...base, totalServicesCount: 2, publishedServicesCount: 1 });
    expect(statusOf(r, "verification")).toBe("COMPLETE");
    expect(statusOf(r, "firstService")).toBe("COMPLETE");
    expect(statusOf(r, "publish")).toBe("COMPLETE");
    expect(r.marketplaceReady).toBe(true);
    expect(r.primaryCtaKey).toBeNull();
  });

  it("profile is OPTIONAL and never becomes the primary CTA", () => {
    const withProfileGap = deriveProviderActivation(base);
    expect(statusOf(withProfileGap, "profile")).toBe("OPTIONAL");
    expect(withProfileGap.primaryCtaKey).toBe("firstService"); // not profile

    const withProfile = deriveProviderActivation({ ...base, profileComplete: true });
    expect(statusOf(withProfile, "profile")).toBe("COMPLETE");
  });

  it("no required documents (verificationRequiredTotal 0) counts verification COMPLETE", () => {
    const r = deriveProviderActivation({ ...base, verificationRequiredTotal: 0, verificationRequiredApproved: 0 });
    expect(statusOf(r, "verification")).toBe("COMPLETE");
    expect(r.primaryCtaKey).toBe("firstService");
  });

  it("not-approved provider → not approved, no primary CTA, not marketplace-ready", () => {
    for (const providerStatus of ["APPLIED", "UNDER_REVIEW", "SUSPENDED", "REJECTED", "DEACTIVATED"]) {
      const r = deriveProviderActivation({ ...base, providerStatus, totalServicesCount: 3, publishedServicesCount: 2 });
      expect(r.providerApproved).toBe(false);
      expect(r.primaryCtaKey).toBeNull();
      expect(r.marketplaceReady).toBe(false);
    }
  });
});
