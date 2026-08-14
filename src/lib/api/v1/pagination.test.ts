import { describe, it, expect } from "vitest";
import { parsePageParams, toPaginatedDTO, MAX_PAGE_SIZE } from "./pagination";

function sp(query: string): URLSearchParams {
  return new URL(`http://x/?${query}`).searchParams;
}

describe("parsePageParams", () => {
  it("uses defaults when params absent", () => {
    expect(parsePageParams(sp(""), 12)).toEqual({ page: 1, pageSize: 12 });
  });

  it("parses valid page and pageSize", () => {
    expect(parsePageParams(sp("page=3&pageSize=20"), 12)).toEqual({ page: 3, pageSize: 20 });
  });

  it("clamps page to >= 1", () => {
    expect(parsePageParams(sp("page=0"), 12).page).toBe(1);
    expect(parsePageParams(sp("page=-5"), 12).page).toBe(1);
  });

  it("clamps pageSize to >= 1", () => {
    expect(parsePageParams(sp("pageSize=0"), 12).pageSize).toBe(1);
  });

  it("clamps pageSize to MAX_PAGE_SIZE (50)", () => {
    expect(MAX_PAGE_SIZE).toBe(50);
    expect(parsePageParams(sp("pageSize=100"), 12).pageSize).toBe(50);
  });

  it("falls back to default for malformed values", () => {
    expect(parsePageParams(sp("page=abc&pageSize=xyz"), 10)).toEqual({ page: 1, pageSize: 10 });
  });
});

describe("toPaginatedDTO", () => {
  it("maps items and carries metadata through", () => {
    const result = toPaginatedDTO(
      { items: [{ n: 1 }, { n: 2 }], page: 2, pageSize: 10, totalCount: 12, totalPages: 2 },
      (item) => item.n * 10
    );
    expect(result).toEqual({ items: [10, 20], page: 2, pageSize: 10, totalCount: 12, totalPages: 2 });
  });
});
