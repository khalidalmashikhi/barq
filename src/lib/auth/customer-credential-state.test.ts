import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
vi.mock("./session", () => ({ getSession: (...a: unknown[]) => getSessionMock(...a) }));

const { getCustomerCredentialState } = await import("./customer-credential-state");

function session(user: Record<string, unknown>) {
  return { user };
}

beforeEach(() => vi.clearAllMocks());

describe("getCustomerCredentialState — dual-verification authority", () => {
  it("unauthenticated -> nothing verified, incomplete", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await getCustomerCredentialState()).toEqual({
      authenticated: false,
      hasVerifiedEmail: false,
      hasVerifiedPhone: false,
      isComplete: false,
    });
  });

  it("verified phone + verified REAL email -> complete", async () => {
    getSessionMock.mockResolvedValue(
      session({ email: "cust@example.com", emailVerified: true, phoneNumber: "+96898115159", phoneNumberVerified: true })
    );
    const s = await getCustomerCredentialState();
    expect(s).toEqual({ authenticated: true, hasVerifiedEmail: true, hasVerifiedPhone: true, isComplete: true });
  });

  it("verified phone + SYNTHETIC phone email -> email NOT satisfied, incomplete", async () => {
    getSessionMock.mockResolvedValue(
      session({ email: "96898115159@phone.barq.internal", emailVerified: true, phoneNumber: "+96898115159", phoneNumberVerified: true })
    );
    const s = await getCustomerCredentialState();
    expect(s.hasVerifiedPhone).toBe(true);
    expect(s.hasVerifiedEmail).toBe(false); // synthetic never counts
    expect(s.isComplete).toBe(false);
  });

  it("verified email only (no phone) -> needs phone, incomplete", async () => {
    getSessionMock.mockResolvedValue(session({ email: "cust@example.com", emailVerified: true, phoneNumber: null, phoneNumberVerified: false }));
    const s = await getCustomerCredentialState();
    expect(s).toMatchObject({ hasVerifiedEmail: true, hasVerifiedPhone: false, isComplete: false });
  });

  it("Google-first (real verified email) + verified phone -> complete (email not re-verified)", async () => {
    getSessionMock.mockResolvedValue(
      session({ email: "user@gmail.com", emailVerified: true, phoneNumber: "+96891112222", phoneNumberVerified: true })
    );
    expect((await getCustomerCredentialState()).isComplete).toBe(true);
  });

  it("real email present but UNVERIFIED -> email not satisfied", async () => {
    getSessionMock.mockResolvedValue(session({ email: "cust@example.com", emailVerified: false, phoneNumber: "+96898115159", phoneNumberVerified: true }));
    expect((await getCustomerCredentialState()).hasVerifiedEmail).toBe(false);
  });

  it("phone present but UNVERIFIED -> phone not satisfied", async () => {
    getSessionMock.mockResolvedValue(session({ email: "cust@example.com", emailVerified: true, phoneNumber: "+96898115159", phoneNumberVerified: false }));
    expect((await getCustomerCredentialState()).hasVerifiedPhone).toBe(false);
  });
});
