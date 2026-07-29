import { describe, it, expect, vi } from "vitest";

// Phase E.3 — exhaustive matrix test, mirroring
// src/lib/contracts/lifecycle/transitions.test.ts's approach exactly.

vi.mock("server-only", () => ({}));

const { CONTRACT_EXECUTION_STATUSES } = await import("./states");
const { canTransition, getAllowedNextStatuses } = await import("./transitions");

const ALLOWED: Record<(typeof CONTRACT_EXECUTION_STATUSES)[number], string[]> = {
  PENDING_CUSTOMER: ["CUSTOMER_SIGNED", "CANCELLED", "EXPIRED"],
  CUSTOMER_SIGNED: ["PENDING_PROVIDER"],
  PENDING_PROVIDER: ["PROVIDER_SIGNED", "CANCELLED", "EXPIRED"],
  PROVIDER_SIGNED: ["EXECUTED"],
  EXECUTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

describe("canTransition — exhaustive matrix", () => {
  for (const from of CONTRACT_EXECUTION_STATUSES) {
    for (const to of CONTRACT_EXECUTION_STATUSES) {
      const expected = ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }
});

describe("canTransition — requirement #1's example happy path", () => {
  it("supports Pending Customer -> Customer Signed -> Pending Provider -> Provider Signed -> Executed", () => {
    expect(canTransition("PENDING_CUSTOMER", "CUSTOMER_SIGNED")).toBe(true);
    expect(canTransition("CUSTOMER_SIGNED", "PENDING_PROVIDER")).toBe(true);
    expect(canTransition("PENDING_PROVIDER", "PROVIDER_SIGNED")).toBe(true);
    expect(canTransition("PROVIDER_SIGNED", "EXECUTED")).toBe(true);
  });

  it("EXECUTED, CANCELLED, and EXPIRED are all fully terminal", () => {
    expect(getAllowedNextStatuses("EXECUTED")).toEqual([]);
    expect(getAllowedNextStatuses("CANCELLED")).toEqual([]);
    expect(getAllowedNextStatuses("EXPIRED")).toEqual([]);
  });

  it("CANCELLED and EXPIRED are reachable only from the two PENDING_* states", () => {
    expect(canTransition("PENDING_CUSTOMER", "CANCELLED")).toBe(true);
    expect(canTransition("PENDING_PROVIDER", "CANCELLED")).toBe(true);
    expect(canTransition("CUSTOMER_SIGNED", "CANCELLED")).toBe(false);
    expect(canTransition("PROVIDER_SIGNED", "CANCELLED")).toBe(false);
  });
});
