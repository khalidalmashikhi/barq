import { describe, it, expect, vi } from "vitest";

// Phase E.2 — exhaustive matrix test, mirroring
// src/lib/booking/lifecycle/transitions.test.ts's approach exactly:
// every (from, to) pair, not just samples, so a future edit that
// silently loosens or tightens a rule fails a test immediately.

vi.mock("server-only", () => ({}));

const { BOOKING_CONTRACT_STATUSES } = await import("./states");
const { canTransition, getAllowedNextStatuses } = await import("./transitions");

const ALLOWED: Record<(typeof BOOKING_CONTRACT_STATUSES)[number], string[]> = {
  DRAFT: ["GENERATED", "CANCELLED"],
  GENERATED: ["ISSUED", "CANCELLED"],
  ISSUED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED", "EXPIRED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

describe("canTransition — exhaustive matrix", () => {
  for (const from of BOOKING_CONTRACT_STATUSES) {
    for (const to of BOOKING_CONTRACT_STATUSES) {
      const expected = ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }
});

describe("canTransition — requirement #2's example happy path", () => {
  it("supports Draft -> Generated -> Issued -> Active -> Completed", () => {
    expect(canTransition("DRAFT", "GENERATED")).toBe(true);
    expect(canTransition("GENERATED", "ISSUED")).toBe(true);
    expect(canTransition("ISSUED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
  });

  it("COMPLETED, CANCELLED, and EXPIRED are all fully terminal", () => {
    expect(getAllowedNextStatuses("COMPLETED")).toEqual([]);
    expect(getAllowedNextStatuses("CANCELLED")).toEqual([]);
    expect(getAllowedNextStatuses("EXPIRED")).toEqual([]);
  });

  it("CANCELLED is reachable from every non-terminal status", () => {
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransition("GENERATED", "CANCELLED")).toBe(true);
    expect(canTransition("ISSUED", "CANCELLED")).toBe(true);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true);
  });

  it("EXPIRED is reachable only from ACTIVE", () => {
    expect(canTransition("ACTIVE", "EXPIRED")).toBe(true);
    expect(canTransition("DRAFT", "EXPIRED")).toBe(false);
    expect(canTransition("GENERATED", "EXPIRED")).toBe(false);
    expect(canTransition("ISSUED", "EXPIRED")).toBe(false);
  });
});

describe("getAllowedNextStatuses", () => {
  it("returns the exact allowed set for each status", () => {
    for (const status of BOOKING_CONTRACT_STATUSES) {
      expect([...getAllowedNextStatuses(status)].sort()).toEqual([...ALLOWED[status]].sort());
    }
  });
});
