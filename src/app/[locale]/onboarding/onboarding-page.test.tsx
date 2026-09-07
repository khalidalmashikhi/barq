import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. The /onboarding registration hub renders
// by the SERVER-AUTHORITATIVE registration step. No jsdom; the async Server Component is
// called directly and its element tree walked (same convention as the other page tests).

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

class UnauthenticatedError extends Error {}
const requireAuthMock = vi.fn();
const isActiveAdminSessionMock = vi.fn();
const resolveEffectiveAccountTypeMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  isActiveAdminSession: (...a: unknown[]) => isActiveAdminSessionMock(...a),
  resolveEffectiveAccountType: (...a: unknown[]) => resolveEffectiveAccountTypeMock(...a),
  routeForEffectiveAccountType: (t: string) =>
    t === "PROVIDER" ? "/provider" : t === "ADMIN" ? "/admin" : "/dashboard",
  UnauthenticatedError,
}));
const getStepMock = vi.fn();
vi.mock("@/lib/registration/registration-state", () => ({ getRegistrationStepForUser: (...a: unknown[]) => getStepMock(...a) }));
const isEmailOtpConfiguredMock = vi.fn();
vi.mock("@/lib/email-otp/get-email-provider", () => ({ isEmailOtpConfigured: (...a: unknown[]) => isEmailOtpConfiguredMock(...a) }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));

function AddPhoneButtonMock() { return null; }
function AddEmailButtonMock() { return null; }
function LogoutButtonMock() { return null; }
function AccountTypeChooserMock() { return null; }
function RegistrationNameFormMock() { return null; }
function FinalizeRegistrationButtonMock() { return null; }
vi.mock("@/components/auth/add-phone-button", () => ({ AddPhoneButton: AddPhoneButtonMock }));
vi.mock("@/components/auth/add-email-button", () => ({ AddEmailButton: AddEmailButtonMock }));
vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: LogoutButtonMock }));
vi.mock("@/components/auth/registration/account-type-chooser", () => ({ AccountTypeChooser: AccountTypeChooserMock }));
vi.mock("@/components/auth/registration/registration-name-form", () => ({ RegistrationNameForm: RegistrationNameFormMock }));
vi.mock("@/components/auth/registration/finalize-registration-button", () => ({ FinalizeRegistrationButton: FinalizeRegistrationButtonMock }));
vi.mock("@/components/ui/logo", () => ({ Logo: () => null }));

const { default: OnboardingPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ barqUser: { id: "u", name: null, accountType: null } });
  isActiveAdminSessionMock.mockResolvedValue(false);
  isEmailOtpConfiguredMock.mockReturnValue(true);
  resolveEffectiveAccountTypeMock.mockResolvedValue("CUSTOMER");
});

describe("OnboardingPage — registration state machine", () => {
  it("unauthenticated → redirect /login (renders nothing)", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    const tree = await OnboardingPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/login", locale: "en" });
    expect(tree).toBeNull();
  });

  it("active admin → redirect /admin", async () => {
    isActiveAdminSessionMock.mockResolvedValue(true);
    getStepMock.mockResolvedValue("CHOOSE_USAGE");
    const tree = await OnboardingPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/admin", locale: "en" });
    expect(tree).toBeNull();
  });

  it("DONE → redirect to the effective-type landing (e.g. PROVIDER → /provider)", async () => {
    getStepMock.mockResolvedValue("DONE");
    resolveEffectiveAccountTypeMock.mockResolvedValue("PROVIDER");
    const tree = await OnboardingPage();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/provider", locale: "en" });
    expect(tree).toBeNull();
  });

  it("CHOOSE_USAGE → renders the usage chooser, no redirect", async () => {
    getStepMock.mockResolvedValue("CHOOSE_USAGE");
    const tree = (await OnboardingPage()) as ReactElement;
    expect(redirectMock).not.toHaveBeenCalled();
    expect(findByType(tree, AccountTypeChooserMock)).not.toBeNull();
    expect(findByType(tree, LogoutButtonMock)).not.toBeNull();
  });

  it("COMPLETE_DETAILS with no name → renders the name form", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "u", name: null, accountType: "CUSTOMER" } });
    getStepMock.mockResolvedValue("COMPLETE_DETAILS");
    const tree = (await OnboardingPage()) as ReactElement;
    expect(findByType(tree, RegistrationNameFormMock)).not.toBeNull();
    expect(findByType(tree, AddPhoneButtonMock)).toBeNull();
  });

  it("COMPLETE_DETAILS with a name but unverified phone → renders AddPhoneButton", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "u", name: "Sara", accountType: "PROVIDER" } });
    getStepMock.mockResolvedValue("COMPLETE_DETAILS");
    const tree = (await OnboardingPage()) as ReactElement;
    expect(findByType(tree, AddPhoneButtonMock)).not.toBeNull();
    expect(findByType(tree, RegistrationNameFormMock)).toBeNull();
  });

  it("VERIFY_EMAIL (email OTP configured) → renders AddEmailButton", async () => {
    getStepMock.mockResolvedValue("VERIFY_EMAIL");
    const tree = (await OnboardingPage()) as ReactElement;
    expect(findByType(tree, AddEmailButtonMock)).not.toBeNull();
  });

  it("FINALIZE → renders the finish button", async () => {
    getStepMock.mockResolvedValue("FINALIZE");
    const tree = (await OnboardingPage()) as ReactElement;
    expect(findByType(tree, FinalizeRegistrationButtonMock)).not.toBeNull();
    expect(findByType(tree, LogoutButtonMock)).not.toBeNull();
  });
});
