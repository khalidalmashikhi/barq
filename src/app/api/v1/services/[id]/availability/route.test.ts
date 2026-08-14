import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));

const getServiceByIdMock = vi.fn();
vi.mock("@/lib/services/get-service-detail", () => ({
  getServiceById: (...args: unknown[]) => getServiceByIdMock(...args),
}));

const getAvailableSlotsMock = vi.fn();
vi.mock("@/lib/booking/get-available-slots", () => ({
  getAvailableSlots: (...args: unknown[]) => getAvailableSlotsMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => {
  getServiceByIdMock.mockReset();
  getAvailableSlotsMock.mockReset();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/services/{id}/availability", () => {
  it("404s (and never reads slots) when the service is not public — visibility gate preserved", async () => {
    getServiceByIdMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));

    expect(res.status).toBe(404);
    expect(getAvailableSlotsMock).not.toHaveBeenCalled();
  });

  it("returns slot DTOs (ISO dates) with no-store for a public service", async () => {
    getServiceByIdMock.mockResolvedValue({ id: "s1" });
    getAvailableSlotsMock.mockResolvedValue([
      {
        id: "a1",
        startTime: new Date("2026-06-01T09:00:00.000Z"),
        endTime: new Date("2026-06-01T12:00:00.000Z"),
        remainingSeats: 4,
      },
    ]);

    const res = await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getAvailableSlotsMock).toHaveBeenCalledWith("s1");
    const body = await res.json();
    expect(body).toEqual({
      items: [
        {
          id: "a1",
          startTime: "2026-06-01T09:00:00.000Z",
          endTime: "2026-06-01T12:00:00.000Z",
          remainingSeats: 4,
        },
      ],
    });
  });
});
