import { describe, it, expect, vi } from "vitest";

// Phase E.1 (Booking Lifecycle & Contract Foundation) — the transition
// matrix is the one centralized rule set every status change must be
// validated against (requirement #2/#3). This test is exhaustive over
// every (from, to) pair in BOOKING_STATUSES, not just a few examples,
// so any future edit to the matrix that silently loosens or tightens a
// rule fails a test immediately.

vi.mock("server-only", () => ({}));

const { BOOKING_STATUSES } = await import("./states");
const { canTransition, getAllowedNextStatuses } = await import("./transitions");

const ALLOWED: Record<(typeof BOOKING_STATUSES)[number], string[]> = {
  CREATED: ["PENDING_PROVIDER"],
  PENDING_PROVIDER: ["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED", "DISPUTED"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  CANCELLED: [],
  REJECTED: [],
  DISPUTED: [],
  EXPIRED: [],
};

describe("canTransition — exhaustive matrix", () => {
  for (const from of BOOKING_STATUSES) {
    for (const to of BOOKING_STATUSES) {
      const expected = ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }
});

describe("canTransition — this phase's own named example rules", () => {
  it("supports the example's happy path: Created -> Pending Provider -> Accepted -> In Progress -> Completed", () => {
    expect(canTransition("CREATED", "PENDING_PROVIDER")).toBe(true);
    expect(canTransition("PENDING_PROVIDER", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it('"Cancelled cannot become In Progress"', () => {
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
  });

  it("Cancelled is fully terminal — cannot become anything else either", () => {
    expect(getAllowedNextStatuses("CANCELLED")).toEqual([]);
  });

  it("Rejected is fully terminal — cannot become anything else either", () => {
    expect(getAllowedNextStatuses("REJECTED")).toEqual([]);
  });

  it("Expired is fully terminal — cannot become anything else either", () => {
    expect(getAllowedNextStatuses("EXPIRED")).toEqual([]);
  });

  it("Pending Provider can be Accepted, Rejected, Cancelled, or Expired — but nothing else", () => {
    expect([...getAllowedNextStatuses("PENDING_PROVIDER")].sort()).toEqual(
      ["CANCELLED", "CONFIRMED", "EXPIRED", "REJECTED"].sort()
    );
  });
});

describe("getAllowedNextStatuses", () => {
  it("returns the exact allowed set for each status", () => {
    for (const status of BOOKING_STATUSES) {
      expect([...getAllowedNextStatuses(status)].sort()).toEqual([...ALLOWED[status]].sort());
    }
  });
});
