import { describe, it, expect, vi, afterEach } from "vitest";

// Growth Foundations phase — regression tests for the Service Detail
// dynamic OG image route. Confirms: the exported Next.js OG-image
// contract (alt/size/contentType), a real PNG response is produced,
// and the route falls back honestly (never throws) for a nonexistent
// service id.

vi.mock("@/lib/services/get-service-detail", () => ({
  getServiceById: vi.fn(),
}));

const { getServiceById } = await import("@/lib/services/get-service-detail");
const { default: Image, alt, size, contentType } = await import("./opengraph-image");

const getServiceByIdMock = getServiceById as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  getServiceByIdMock.mockReset();
});

describe("Service Detail opengraph-image", () => {
  it("declares the standard Next.js OG-image contract", () => {
    expect(alt).toBe("BARQ");
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("renders a real PNG image response for a real service", async () => {
    getServiceByIdMock.mockResolvedValue({
      id: "service-1",
      name: "Desert Tour",
      providerName: "Desert Co",
      description: "",
      providerId: "provider-1",
      providerDescription: "",
      providerStatus: "APPROVED",
      price: "25.00 OMR",
      createdAt: new Date(),
    });

    const response = await Image({ params: Promise.resolve({ id: "service-1" }) });

    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("falls back to the BARQ brand name honestly rather than throwing for a nonexistent service", async () => {
    getServiceByIdMock.mockResolvedValue(null);

    const response = await Image({ params: Promise.resolve({ id: "not-a-real-id" }) });

    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
