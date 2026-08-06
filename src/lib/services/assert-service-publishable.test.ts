import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const priceFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { price: { findFirst: (...args: unknown[]) => priceFindFirstMock(...args) } },
}));

const { assertServicePublishable } = await import("./assert-service-publishable");

const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => priceFindFirstMock.mockReset());

describe("assertServicePublishable", () => {
  it("returns no blockers when categorized and priced", async () => {
    priceFindFirstMock.mockResolvedValue({ id: "price-1" });
    expect(await assertServicePublishable({ id: ID, categoryId: "cat-1" })).toEqual([]);
  });

  it("returns both blockers, category first, when uncategorized and priceless", async () => {
    priceFindFirstMock.mockResolvedValue(null);
    expect(await assertServicePublishable({ id: ID, categoryId: null })).toEqual([
      "SERVICE_CATEGORY_REQUIRED",
      "NO_ACTIVE_PRICE",
    ]);
  });

  it("returns only the category blocker when priced but uncategorized", async () => {
    priceFindFirstMock.mockResolvedValue({ id: "price-1" });
    expect(await assertServicePublishable({ id: ID, categoryId: null })).toEqual(["SERVICE_CATEGORY_REQUIRED"]);
  });

  it("returns only the price blocker when categorized but priceless", async () => {
    priceFindFirstMock.mockResolvedValue(null);
    expect(await assertServicePublishable({ id: ID, categoryId: "cat-1" })).toEqual(["NO_ACTIVE_PRICE"]);
  });
});
