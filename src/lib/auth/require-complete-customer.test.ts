import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getStateMock = vi.fn();
vi.mock("./customer-credential-state", () => ({ getCustomerCredentialState: (...a: unknown[]) => getStateMock(...a) }));
const isActiveAdminSessionMock = vi.fn();
vi.mock("./index", () => ({ isActiveAdminSession: (...a: unknown[]) => isActiveAdminSessionMock(...a) }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { requireCompleteCustomer } = await import("./require-complete-customer");

beforeEach(() => {
  vi.clearAllMocks();
  isActiveAdminSessionMock.mockResolvedValue(false);
});

describe("requireCompleteCustomer — dual-verification gate", () => {
  it("does NOT redirect a complete customer", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: true });
    await requireCompleteCustomer();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does NOT redirect an unauthenticated visitor (the page owns /login)", async () => {
    getStateMock.mockResolvedValue({ authenticated: false, isComplete: false });
    await requireCompleteCustomer();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects an incomplete authenticated customer to /onboarding", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: false });
    await requireCompleteCustomer();
    expect(redirectMock).toHaveBeenCalledWith({ href: "/onboarding", locale: "en" });
  });

  it("never funnels an ACTIVE admin through customer onboarding", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: false });
    isActiveAdminSessionMock.mockResolvedValue(true);
    await requireCompleteCustomer();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
