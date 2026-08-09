import { describe, it, expect, vi } from "vitest";

// Provider Review / Reject / Resubmit — the status presentation maps must
// cover REJECTED (they are compile-enforced via satisfies Record<ProviderStatus>,
// but this also pins the chosen badge variant + label key and proves no known
// status silently falls back).

vi.mock("server-only", () => ({}));

const { getProviderStatusBadgeVariant, getProviderStatusTranslationKey } = await import("./provider-status");

describe("provider-status presentation", () => {
  it("maps REJECTED to a danger badge and the statusRejected label key", () => {
    expect(getProviderStatusBadgeVariant("REJECTED")).toBe("danger");
    expect(getProviderStatusTranslationKey("REJECTED")).toBe("statusRejected");
  });

  it("resolves every ProviderStatus to its own distinct label key (no fallback for known values)", () => {
    expect(getProviderStatusTranslationKey("APPLIED")).toBe("statusApplied");
    expect(getProviderStatusTranslationKey("UNDER_REVIEW")).toBe("statusUnderReview");
    expect(getProviderStatusTranslationKey("APPROVED")).toBe("statusApproved");
    expect(getProviderStatusTranslationKey("REJECTED")).toBe("statusRejected");
    expect(getProviderStatusTranslationKey("SUSPENDED")).toBe("statusSuspended");
    expect(getProviderStatusTranslationKey("DEACTIVATED")).toBe("statusDeactivated");
  });
});
