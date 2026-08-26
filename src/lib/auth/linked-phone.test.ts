import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
vi.mock("./session", () => ({ getSession: (...a: unknown[]) => getSessionMock(...a) }));

const { getLinkedPhoneState } = await import("./linked-phone");

beforeEach(() => vi.clearAllMocks());

describe("getLinkedPhoneState", () => {
  it("returns null when unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await getLinkedPhoneState()).toBeNull();
  });

  it("hasPhone=false when no phone (email-first / Google-first account)", async () => {
    getSessionMock.mockResolvedValue({ user: { phoneNumber: null, phoneNumberVerified: false } });
    expect(await getLinkedPhoneState()).toEqual({ hasPhone: false, maskedPhone: null });
  });

  it("hasPhone=false for an unverified phone", async () => {
    getSessionMock.mockResolvedValue({ user: { phoneNumber: "+96898115159", phoneNumberVerified: false } });
    expect(await getLinkedPhoneState()).toEqual({ hasPhone: false, maskedPhone: null });
  });

  it("hasPhone=true + masked for a verified phone (Connected shown)", async () => {
    getSessionMock.mockResolvedValue({ user: { phoneNumber: "+96898115159", phoneNumberVerified: true } });
    const state = await getLinkedPhoneState();
    expect(state?.hasPhone).toBe(true);
    expect(state?.maskedPhone).toBe("********5159"); // last 4 kept (8 masked)
    expect(JSON.stringify(state)).not.toContain("+96898115159"); // full number never returned
  });
});
