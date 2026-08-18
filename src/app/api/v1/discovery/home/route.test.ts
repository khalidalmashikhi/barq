import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));

const getHomeDiscoveryMock = vi.fn();
vi.mock("@/lib/discovery/get-home-discovery", () => ({
  getHomeDiscovery: (...args: unknown[]) => getHomeDiscoveryMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => getHomeDiscoveryMock.mockReset());

describe("GET /api/v1/discovery/home", () => {
  it("passes the resolved locale + region to the SAME domain reader and returns it (public-safe shape)", async () => {
    const payload = {
      governorates: [{ code: "DHOFAR", labelKey: "governorate.DHOFAR" }],
      selectedGovernorate: "DHOFAR",
      groups: [{ key: "EXPERIENCES", labelKey: "discoveryExperiences", iconKey: "compass", categorySlugs: ["adventures"], previewItems: [] }],
      recommended: [],
      destinations: [{ code: "DHOFAR", labelKey: "governorate.DHOFAR" }],
    };
    getHomeDiscoveryMock.mockResolvedValue(payload);

    const res = await GET(new Request("http://localhost/api/v1/discovery/home?locale=en&region=DHOFAR"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getHomeDiscoveryMock).toHaveBeenCalledWith({ regionCode: "DHOFAR", locale: "en" });
    expect(await res.json()).toEqual(payload);
  });

  it("passes region=null (ALL OMAN) when the param is absent", async () => {
    getHomeDiscoveryMock.mockResolvedValue({ governorates: [], selectedGovernorate: null, groups: [], recommended: [], destinations: [] });
    await GET(new Request("http://localhost/api/v1/discovery/home?locale=ar"));
    expect(getHomeDiscoveryMock).toHaveBeenCalledWith({ regionCode: null, locale: "ar" });
  });
});
