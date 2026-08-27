import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getStateMock = vi.fn();
vi.mock("./customer-credential-state", () => ({ getCustomerCredentialState: (...a: unknown[]) => getStateMock(...a) }));
const isActiveAdminSessionMock = vi.fn();
vi.mock("./index", () => ({ isActiveAdminSession: (...a: unknown[]) => isActiveAdminSessionMock(...a) }));
const redirectMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { requireCompleteCustomer, isCustomerCompleteForAction } = await import(
  "./require-complete-customer"
);

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

// PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — the SAME rule, asked without navigating.
//
// These sit beside the redirect tests on purpose: the pair is the whole architecture.
// One authority decides; the caller decides how to say it. If these two ever disagree,
// Web and the API would be enforcing different rules — which is the failure this
// arrangement exists to make impossible.
describe("isCustomerCompleteForAction — the same gate, without a redirect", () => {
  it("permits a complete customer", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: true });

    expect(await isCustomerCompleteForAction()).toBe(true);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("refuses an incomplete authenticated customer", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: false });

    expect(await isCustomerCompleteForAction()).toBe(false);
  });

  /** NEVER NAVIGATES. That is the entire reason this function exists. */
  it("refuses without redirecting anywhere", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: false });

    await isCustomerCompleteForAction();

    expect(redirectMock).not.toHaveBeenCalled();
  });

  /**
   * Authentication is the CALLER's gate. Turning a missing session into a completeness
   * failure would answer "verify your email" to someone who is not even signed in.
   */
  it("does not treat an unauthenticated visitor as incomplete", async () => {
    getStateMock.mockResolvedValue({ authenticated: false, isComplete: false });

    expect(await isCustomerCompleteForAction()).toBe(true);
  });

  it("exempts an ACTIVE admin, exactly as the redirecting guard does", async () => {
    getStateMock.mockResolvedValue({ authenticated: true, isComplete: false });
    isActiveAdminSessionMock.mockResolvedValue(true);

    expect(await isCustomerCompleteForAction()).toBe(true);
  });

  /**
   * THE TWO MUST AGREE. Same inputs, same verdict — one redirects, one reports. A
   * divergence here would mean Web and the API disagree about who may book.
   */
  it("agrees with the redirecting guard on every input", async () => {
    const cases = [
      { authenticated: true, isComplete: true, admin: false, permitted: true },
      { authenticated: true, isComplete: false, admin: false, permitted: false },
      { authenticated: false, isComplete: false, admin: false, permitted: true },
      { authenticated: true, isComplete: false, admin: true, permitted: true },
    ];

    for (const c of cases) {
      vi.clearAllMocks();
      getStateMock.mockResolvedValue({ authenticated: c.authenticated, isComplete: c.isComplete });
      isActiveAdminSessionMock.mockResolvedValue(c.admin);

      const permitted = await isCustomerCompleteForAction();
      expect(permitted).toBe(c.permitted);

      vi.clearAllMocks();
      getStateMock.mockResolvedValue({ authenticated: c.authenticated, isComplete: c.isComplete });
      isActiveAdminSessionMock.mockResolvedValue(c.admin);
      await requireCompleteCustomer();

      // The guard redirects in exactly the cases the predicate refuses.
      expect(redirectMock.mock.calls.length === 0).toBe(permitted);
    }
  });
});
