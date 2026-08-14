import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));

const getPublicRootCategoriesMock = vi.fn();
vi.mock("@/lib/categories/get-public-root-categories", () => ({
  getPublicRootCategories: (...args: unknown[]) => getPublicRootCategoriesMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => getPublicRootCategoriesMock.mockReset());

describe("GET /api/v1/categories", () => {
  it("passes the resolved locale and maps to CategoryDTOs (public-only comes from the reader)", async () => {
    getPublicRootCategoriesMock.mockResolvedValue([
      { id: "c1", slug: "tours-experiences", label: "Tours & Experiences" },
      { id: "c2", slug: "cars", label: "Cars" },
    ]);

    const res = await GET(new Request("http://localhost/api/v1/categories?locale=en"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getPublicRootCategoriesMock).toHaveBeenCalledWith("en");
    const body = await res.json();
    expect(body).toEqual({
      items: [
        { id: "c1", slug: "tours-experiences", label: "Tours & Experiences" },
        { id: "c2", slug: "cars", label: "Cars" },
      ],
    });
  });
});
