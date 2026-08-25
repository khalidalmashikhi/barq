import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// Social Login (Gate 3) — server-component wiring tests for the login page and
// the Settings "Sign-in methods" section. (Client-side button interaction is
// covered by next build + manual, since the repo has no testing-library/jsdom;
// the identity/security behavior is covered by barq-user.test.ts + social-config.test.ts.)

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

// ---- shared mocks ----
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn(), Link: (p: Record<string, unknown>) => ({ type: "a", props: p }) }));
vi.mock("@/lib/i18n/metadata", () => ({ buildLocalizedMetadata: vi.fn() }));

// login-page deps
const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: (...a: unknown[]) => getSessionMock(...a), UnauthenticatedError: class extends Error {}, isActiveAdminSession: async () => false }));
const isGoogleConfiguredMock = vi.fn();
vi.mock("@/lib/auth/social-config", () => ({ isGoogleConfigured: (...a: unknown[]) => isGoogleConfiguredMock(...a) }));
// AUTH-CUSTOMER-EMAIL-OTP — the login page now also reads isEmailOtpConfigured
// (server-only); mock it so the real module isn't pulled into the test.
const isEmailOtpConfiguredMock = vi.fn();
vi.mock("@/lib/email-otp/get-email-provider", () => ({ isEmailOtpConfigured: (...a: unknown[]) => isEmailOtpConfiguredMock(...a) }));
function LoginFormMock() {
  return null;
}
vi.mock("@/components/auth/login-form", () => ({ LoginForm: LoginFormMock }));
vi.mock("@/components/ui/logo", () => ({ Logo: () => null }));

// settings-page deps
vi.mock("@/lib/customer/get-customer-settings", () => ({
  getCustomerSettings: vi.fn().mockResolvedValue({ name: "", phoneNumber: null, languagePreference: "" }),
}));
vi.mock("@/lib/customer/update-customer-settings", () => ({ updateCustomerSettings: vi.fn() }));
vi.mock("@/lib/notifications/get-unread-count", () => ({ getUnreadCount: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/dashboard/customer-nav-items", () => ({ getCustomerNavItems: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/dashboard/resolve-customer-nav-options", () => ({ resolveCustomerNavOptions: vi.fn().mockResolvedValue({}) }));
vi.mock("@/components/app-shell/app-shell", () => ({ AppShell: (p: { children: unknown }) => p.children }));
vi.mock("@/i18n/locales", () => ({ locales: ["en", "ar"] }));
const getLinkedProviderIdsMock = vi.fn();
vi.mock("@/lib/auth/connected-accounts", () => ({ getLinkedProviderIds: (...a: unknown[]) => getLinkedProviderIdsMock(...a) }));
function ConnectGoogleButtonMock() {
  return null;
}
vi.mock("@/components/auth/connect-google-button", () => ({ ConnectGoogleButton: ConnectGoogleButtonMock }));
// AUTH-EMAIL-LINK-1 — settings page now also reads the linked-email state (server-only)
// and renders the email linking client component; mock both so the real modules aren't pulled in.
const getLinkedEmailStateMock = vi.fn();
vi.mock("@/lib/auth/linked-email", () => ({ getLinkedEmailState: (...a: unknown[]) => getLinkedEmailStateMock(...a) }));
function AddEmailButtonMock() {
  return null;
}
vi.mock("@/components/auth/add-email-button", () => ({ AddEmailButton: AddEmailButtonMock }));

const { default: LoginPage } = await import("@/app/[locale]/login/page");
const { default: SettingsPage } = await import("@/app/[locale]/dashboard/settings/page");

describe("Login page — Google wiring", () => {
  it("passes googleEnabled=true and renders LoginForm (OTP always available) when Google is configured", async () => {
    getSessionMock.mockResolvedValue(null);
    isGoogleConfiguredMock.mockReturnValue(true);
    const tree = (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    const form = findByType(tree, LoginFormMock);
    expect(form).not.toBeNull();
    expect(form.props.googleEnabled).toBe(true);
    expect(form.props.oauthError).toBe(false);
  });

  it("passes googleEnabled=false when Google is not configured (LoginForm/OTP still rendered)", async () => {
    getSessionMock.mockResolvedValue(null);
    isGoogleConfiguredMock.mockReturnValue(false);
    const tree = (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    const form = findByType(tree, LoginFormMock);
    expect(form.props.googleEnabled).toBe(false);
  });

  it("surfaces an OAuth error to the form via oauthError when redirected back with ?error", async () => {
    getSessionMock.mockResolvedValue(null);
    isGoogleConfiguredMock.mockReturnValue(true);
    const tree = (await LoginPage({ searchParams: Promise.resolve({ error: "oauth" }) })) as ReactElement;
    const form = findByType(tree, LoginFormMock);
    expect(form.props.oauthError).toBe(true);
  });

  it("AUTH-CUSTOMER-EMAIL-OTP — passes emailEnabled through from isEmailOtpConfigured (both states)", async () => {
    getSessionMock.mockResolvedValue(null);
    isGoogleConfiguredMock.mockReturnValue(false);

    isEmailOtpConfiguredMock.mockReturnValue(true);
    let tree = (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(findByType(tree, LoginFormMock).props.emailEnabled).toBe(true);

    isEmailOtpConfiguredMock.mockReturnValue(false);
    tree = (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(findByType(tree, LoginFormMock).props.emailEnabled).toBe(false);
  });
});

describe("Settings — Sign-in methods section", () => {
  // Default: email linking off (INERT) so the existing Google-only assertions hold.
  beforeEach(() => {
    isEmailOtpConfiguredMock.mockReturnValue(false);
    getLinkedEmailStateMock.mockResolvedValue({ hasRealEmail: false, maskedEmail: null });
  });

  it("shows Connected when the account has Google linked", async () => {
    isGoogleConfiguredMock.mockReturnValue(true);
    getLinkedProviderIdsMock.mockResolvedValue(["google"]);
    const tree = (await SettingsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(containsText(tree, "connectedLabel")).toBe(true);
    expect(findByType(tree, ConnectGoogleButtonMock)).toBeNull(); // no connect button when already connected
  });

  it("shows the Connect Google action when not linked", async () => {
    isGoogleConfiguredMock.mockReturnValue(true);
    getLinkedProviderIdsMock.mockResolvedValue([]);
    const tree = (await SettingsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(findByType(tree, ConnectGoogleButtonMock)).not.toBeNull();
    expect(containsText(tree, "connectedLabel")).toBe(false);
  });

  it("hides the whole section when neither Google nor email is configured", async () => {
    isGoogleConfiguredMock.mockReturnValue(false);
    getLinkedProviderIdsMock.mockResolvedValue([]);
    const tree = (await SettingsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(containsText(tree, "connectedAccountsTitle")).toBe(false);
    expect(findByType(tree, ConnectGoogleButtonMock)).toBeNull();
  });

  // --- AUTH-EMAIL-LINK-1 — email row ---

  it("shows Add email (section visible) when email OTP is configured and no real email is linked", async () => {
    isGoogleConfiguredMock.mockReturnValue(false);
    isEmailOtpConfiguredMock.mockReturnValue(true);
    getLinkedEmailStateMock.mockResolvedValue({ hasRealEmail: false, maskedEmail: null });
    const tree = (await SettingsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(containsText(tree, "connectedAccountsTitle")).toBe(true); // section shown even without Google
    expect(containsText(tree, "emailMethodLabel")).toBe(true);
    expect(findByType(tree, AddEmailButtonMock)).not.toBeNull();
  });

  it("shows the masked email + Connected (no Add email) when a real email is linked", async () => {
    isGoogleConfiguredMock.mockReturnValue(false);
    isEmailOtpConfiguredMock.mockReturnValue(true);
    getLinkedEmailStateMock.mockResolvedValue({ hasRealEmail: true, maskedEmail: "c***@example.com" });
    const tree = (await SettingsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(containsText(tree, "c***@example.com")).toBe(true);
    expect(containsText(tree, "connectedLabel")).toBe(true);
    expect(findByType(tree, AddEmailButtonMock)).toBeNull();
  });

  it("hides the email row when email OTP is not configured (INERT)", async () => {
    isGoogleConfiguredMock.mockReturnValue(true); // section visible via Google
    isEmailOtpConfiguredMock.mockReturnValue(false);
    getLinkedProviderIdsMock.mockResolvedValue([]);
    const tree = (await SettingsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(containsText(tree, "emailMethodLabel")).toBe(false);
    expect(findByType(tree, AddEmailButtonMock)).toBeNull();
  });
});
