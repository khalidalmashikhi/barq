import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// AUTH-DUAL-VERIFICATION-1 — server-component routing tests for the mandatory
// completion page (mirrors google-social-login.test.tsx's mocking style; no jsdom).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findByType(node: any, marker: unknown): any | null {
  if (node == null || typeof node !== "object") return null;
  if (node.type === marker) return node;
  if (Array.isArray(node)) {
    for (const c of node) {
      const f = findByType(c, marker);
      if (f) return f;
    }
    return null;
  }
  return findByType(node.props?.children, marker);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function containsText(node: any, needle: string): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.includes(needle);
  if (Array.isArray(node)) return node.some((c) => containsText(c, needle));
  if (typeof node === "object") return containsText(node.props?.children, needle);
  return false;
}

class UnauthenticatedError extends Error {}
const requireAuthMock = vi.fn();
const isActiveAdminSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  isActiveAdminSession: (...a: unknown[]) => isActiveAdminSessionMock(...a),
  UnauthenticatedError,
}));
const getStateMock = vi.fn();
vi.mock("@/lib/auth/customer-credential-state", () => ({ getCustomerCredentialState: (...a: unknown[]) => getStateMock(...a) }));
const isEmailOtpConfiguredMock = vi.fn();
vi.mock("@/lib/email-otp/get-email-provider", () => ({ isEmailOtpConfigured: (...a: unknown[]) => isEmailOtpConfiguredMock(...a) }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
function AddPhoneButtonMock() { return null; }
function AddEmailButtonMock() { return null; }
vi.mock("@/components/auth/add-phone-button", () => ({ AddPhoneButton: AddPhoneButtonMock }));
vi.mock("@/components/auth/add-email-button", () => ({ AddEmailButton: AddEmailButtonMock }));
vi.mock("@/components/ui/logo", () => ({ Logo: () => null }));

const { default: OnboardingPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ authUserId: "a", barqUser: { id: "u" } });
  isActiveAdminSessionMock.mockResolvedValue(false);
  isEmailOtpConfiguredMock.mockReturnValue(true);
});

describe("OnboardingPage routing", () => {
  it("unauthenticated -> redirect /login (renders nothing)", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    const tree = await OnboardingPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/login", locale: "en" });
    expect(tree).toBeNull();
  });

  it("active admin -> redirect /admin", async () => {
    isActiveAdminSessionMock.mockResolvedValue(true);
    getStateMock.mockResolvedValue({ authenticated: true, hasVerifiedEmail: false, hasVerifiedPhone: false, isComplete: false });
    const tree = await OnboardingPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/admin", locale: "en" });
    expect(tree).toBeNull();
  });

  it("complete customer -> redirect /dashboard", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, hasVerifiedEmail: true, hasVerifiedPhone: true, isComplete: true });
    const tree = await OnboardingPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/dashboard", locale: "en" });
    expect(tree).toBeNull();
  });

  it("email-first (needs phone) -> renders AddPhoneButton, no redirect", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, hasVerifiedEmail: true, hasVerifiedPhone: false, isComplete: false });
    const tree = (await OnboardingPage()) as ReactElement;
    expect(redirectMock).not.toHaveBeenCalled();
    expect(findByType(tree, AddPhoneButtonMock)).not.toBeNull();
    expect(findByType(tree, AddEmailButtonMock)).toBeNull();
  });

  it("phone-first (needs email, vendor configured) -> renders AddEmailButton", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, hasVerifiedEmail: false, hasVerifiedPhone: true, isComplete: false });
    const tree = (await OnboardingPage()) as ReactElement;
    expect(findByType(tree, AddEmailButtonMock)).not.toBeNull();
    expect(findByType(tree, AddPhoneButtonMock)).toBeNull();
  });

  it("needs email but email OTP not configured -> shows unavailable, no button", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, hasVerifiedEmail: false, hasVerifiedPhone: true, isComplete: false });
    isEmailOtpConfiguredMock.mockReturnValue(false);
    const tree = (await OnboardingPage()) as ReactElement;
    expect(findByType(tree, AddEmailButtonMock)).toBeNull();
    expect(containsText(tree, "onboardingUnavailable")).toBe(true);
  });
});
