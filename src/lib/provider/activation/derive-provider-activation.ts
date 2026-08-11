// Provider activation (first-run) — pure derivation. No Prisma, no React, no
// server-only: it takes already-loaded real signals and returns the checklist
// state, so it is exhaustively unit-testable and the UI never re-derives domain
// rules. It invents NO new lifecycle — it only reflects rules that already exist:
//   - BR-001: only an APPROVED provider can create/publish services.
//   - BR-029: required verification documents must be APPROVED before an admin
//     approves the provider — so for a freshly-approved provider verification is
//     already COMPLETE; a grandfathered provider may still have it outstanding.
//   - Publishing a service is the existing "ready to receive bookings" state.
// Profile completion is genuinely OPTIONAL (it never gates any domain action).

export type ActivationStatus = "COMPLETE" | "CURRENT" | "BLOCKED" | "OPTIONAL";
export type ActivationStepKey = "verification" | "profile" | "firstService" | "publish";

export type ActivationStep = {
  key: ActivationStepKey;
  status: ActivationStatus;
  href: string;
};

export type ProviderActivation = {
  providerApproved: boolean;
  /** approved + verification complete + at least one PUBLISHED service. */
  marketplaceReady: boolean;
  steps: ActivationStep[];
  /** the single most important actionable step (a required CURRENT step), or null. */
  primaryCtaKey: ActivationStepKey | null;
};

export type ActivationInput = {
  providerStatus: string;
  profileComplete: boolean;
  verificationRequiredTotal: number;
  verificationRequiredApproved: number;
  totalServicesCount: number;
  publishedServicesCount: number;
};

// Existing routes only — never a new destination.
export const ACTIVATION_STEP_HREFS: Record<ActivationStepKey, string> = {
  verification: "/provider/verification",
  profile: "/provider/settings",
  firstService: "/provider/services/new",
  publish: "/provider/services",
};

export function deriveProviderActivation(input: ActivationInput): ProviderActivation {
  const providerApproved = input.providerStatus === "APPROVED";

  const verificationComplete =
    input.verificationRequiredTotal === 0 ||
    input.verificationRequiredApproved >= input.verificationRequiredTotal;
  const hasService = input.totalServicesCount > 0;
  const hasPublished = input.publishedServicesCount > 0;

  const verificationStatus: ActivationStatus = verificationComplete ? "COMPLETE" : "CURRENT";
  // Optional — reflects that no domain rule requires it.
  const profileStatus: ActivationStatus = input.profileComplete ? "COMPLETE" : "OPTIONAL";

  let firstServiceStatus: ActivationStatus;
  if (hasService) firstServiceStatus = "COMPLETE";
  else if (verificationComplete) firstServiceStatus = "CURRENT";
  else firstServiceStatus = "BLOCKED";

  let publishStatus: ActivationStatus;
  if (hasPublished) publishStatus = "COMPLETE";
  else if (hasService) publishStatus = "CURRENT";
  else publishStatus = "BLOCKED";

  const steps: ActivationStep[] = [
    { key: "verification", status: verificationStatus, href: ACTIVATION_STEP_HREFS.verification },
    { key: "profile", status: profileStatus, href: ACTIVATION_STEP_HREFS.profile },
    { key: "firstService", status: firstServiceStatus, href: ACTIVATION_STEP_HREFS.firstService },
    { key: "publish", status: publishStatus, href: ACTIVATION_STEP_HREFS.publish },
  ];

  // Primary CTA = the first REQUIRED step that is CURRENT (profile is optional
  // and never becomes the primary call to action). Only meaningful once approved.
  const requiredOrder: ActivationStepKey[] = ["verification", "firstService", "publish"];
  const primaryCtaKey = providerApproved
    ? requiredOrder.find((key) => steps.find((s) => s.key === key)?.status === "CURRENT") ?? null
    : null;

  const marketplaceReady = providerApproved && verificationComplete && hasPublished;

  return { providerApproved, marketplaceReady, steps, primaryCtaKey };
}
