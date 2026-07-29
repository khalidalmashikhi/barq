import { describe, it, expect, vi } from "vitest";

// Phase 4.2 (Provider Experience) — exhaustive regression test for the
// Service status transition matrix, mirroring booking's own
// transitions.test.ts exhaustive-matrix pattern.

vi.mock("server-only", () => ({}));

const { canTransitionServiceStatus, canPublishService, canUnpublishService, canArchiveService } = await import(
  "./service-status-policy"
);

const STATUSES = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"] as const;

const ALLOWED: Record<(typeof STATUSES)[number], string[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["PAUSED", "ARCHIVED"],
  PAUSED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: [],
};

describe("canTransitionServiceStatus — exhaustive matrix", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "allowed" : "rejected"}`, () => {
        expect(canTransitionServiceStatus(from, to)).toBe(expected);
      });
    }
  }
});

describe("canPublishService", () => {
  it("is true for DRAFT and PAUSED", () => {
    expect(canPublishService("DRAFT")).toBe(true);
    expect(canPublishService("PAUSED")).toBe(true);
  });
  it("is false for PUBLISHED and ARCHIVED", () => {
    expect(canPublishService("PUBLISHED")).toBe(false);
    expect(canPublishService("ARCHIVED")).toBe(false);
  });
});

describe("canUnpublishService", () => {
  it("is true only for PUBLISHED", () => {
    expect(canUnpublishService("PUBLISHED")).toBe(true);
  });
  it("is false for DRAFT, PAUSED, and ARCHIVED", () => {
    expect(canUnpublishService("DRAFT")).toBe(false);
    expect(canUnpublishService("PAUSED")).toBe(false);
    expect(canUnpublishService("ARCHIVED")).toBe(false);
  });
});

describe("canArchiveService", () => {
  it("is true for DRAFT, PUBLISHED, and PAUSED", () => {
    expect(canArchiveService("DRAFT")).toBe(true);
    expect(canArchiveService("PUBLISHED")).toBe(true);
    expect(canArchiveService("PAUSED")).toBe(true);
  });
  it("is fully terminal — false for ARCHIVED itself", () => {
    expect(canArchiveService("ARCHIVED")).toBe(false);
  });
});
