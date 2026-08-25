import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
vi.mock("./session", () => ({ getSession: (...a: unknown[]) => getSessionMock(...a) }));

const { getLinkedEmailState, isSyntheticAuthEmail } = await import("./linked-email");

beforeEach(() => vi.clearAllMocks());

describe("isSyntheticAuthEmail", () => {
  it("detects the phone plugin's synthetic domain, case-insensitively", () => {
    expect(isSyntheticAuthEmail("96890000000@phone.barq.internal")).toBe(true);
    expect(isSyntheticAuthEmail("X@PHONE.BARQ.INTERNAL")).toBe(true);
  });
  it("treats real addresses as non-synthetic", () => {
    expect(isSyntheticAuthEmail("user@example.com")).toBe(false);
    expect(isSyntheticAuthEmail(null)).toBe(false);
    expect(isSyntheticAuthEmail(undefined)).toBe(false);
  });
});

describe("getLinkedEmailState", () => {
  it("returns null when unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await getLinkedEmailState()).toBeNull();
  });

  it("hasRealEmail=false for a synthetic phone email (Add email offered)", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "98115159@phone.barq.internal", emailVerified: true } });
    expect(await getLinkedEmailState()).toEqual({ hasRealEmail: false, maskedEmail: null });
  });

  it("hasRealEmail=false for a real but UNVERIFIED email", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "user@example.com", emailVerified: false } });
    expect(await getLinkedEmailState()).toEqual({ hasRealEmail: false, maskedEmail: null });
  });

  it("hasRealEmail=true + masked for a real verified email (Connected shown)", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "customer@example.com", emailVerified: true } });
    const state = await getLinkedEmailState();
    expect(state?.hasRealEmail).toBe(true);
    expect(state?.maskedEmail).toBe("c*******@example.com");
    // never returns the raw email
    expect(JSON.stringify(state)).not.toContain("customer@example.com");
  });
});
