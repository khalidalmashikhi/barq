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
const serviceRequiresSlotMock = vi.fn();
vi.mock("@/lib/booking/get-available-slots", () => ({
  getAvailableSlots: (...args: unknown[]) => getAvailableSlotsMock(...args),
}));

vi.mock("@/lib/booking/service-requires-slot", () => ({
  serviceRequiresSlot: (...args: unknown[]) => serviceRequiresSlotMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => {
  getServiceByIdMock.mockReset();
  getAvailableSlotsMock.mockReset();
  serviceRequiresSlotMock.mockReset();
  serviceRequiresSlotMock.mockResolvedValue(false);
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/services/{id}/availability", () => {
  it("404s (and never reads slots) when the service is not public — visibility gate preserved", async () => {
    getServiceByIdMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));

    expect(res.status).toBe(404);
    expect(getAvailableSlotsMock).not.toHaveBeenCalled();
    // The visibility gate still runs FIRST: a non-public service leaks neither its
    // slots nor whether it is slot-based.
    expect(serviceRequiresSlotMock).not.toHaveBeenCalled();
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
    // BOOKING-SLOT-AUTHORITY widened this envelope additively. Kept as EXACT equality
    // rather than relaxed to toMatchObject: the whole value of this assertion is that
    // an unexpected extra field fails here instead of silently reaching a client.
    expect(body).toEqual({
      requiresSlot: false,
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

  // BOOKING-SLOT-AUTHORITY — `items` alone was ambiguous. These three cases are the
  // whole reason the field exists.
  describe("requiresSlot", () => {
    it("is false with an empty list for a genuinely slotless service", async () => {
      getServiceByIdMock.mockResolvedValue({ id: "s1" });
      serviceRequiresSlotMock.mockResolvedValue(false);
      getAvailableSlotsMock.mockResolvedValue([]);

      const res = await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));

      expect(await res.json()).toEqual({ requiresSlot: false, items: [] });
    });

    /**
     * THE CASE NOTHING COULD PREVIOUSLY EXPRESS: slot-based, but everything is full,
     * past or blocked. Identical `items` to the case above, opposite product meaning.
     */
    it("is true with an empty list for a slot-based service with nothing bookable", async () => {
      getServiceByIdMock.mockResolvedValue({ id: "s1" });
      serviceRequiresSlotMock.mockResolvedValue(true);
      getAvailableSlotsMock.mockResolvedValue([]);

      const res = await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));

      expect(await res.json()).toEqual({ requiresSlot: true, items: [] });
    });

    it("is true alongside real slots", async () => {
      getServiceByIdMock.mockResolvedValue({ id: "s1" });
      serviceRequiresSlotMock.mockResolvedValue(true);
      getAvailableSlotsMock.mockResolvedValue([
        {
          id: "a1",
          startTime: new Date("2026-06-01T09:00:00.000Z"),
          endTime: new Date("2026-06-01T12:00:00.000Z"),
          remainingSeats: 4,
        },
      ]);

      const res = await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));
      const body = await res.json();

      expect(body.requiresSlot).toBe(true);
      expect(body.items).toHaveLength(1);
    });

    /** Presentation and enforcement must read the SAME authority, for the SAME service. */
    it("derives the flag from serviceRequiresSlot, keyed on the resolved service id", async () => {
      getServiceByIdMock.mockResolvedValue({ id: "resolved-id" });
      serviceRequiresSlotMock.mockResolvedValue(true);
      getAvailableSlotsMock.mockResolvedValue([]);

      await GET(new Request("http://localhost/api/v1/services/s1/availability"), params("s1"));

      expect(serviceRequiresSlotMock).toHaveBeenCalledWith("resolved-id");
    });
  });
});
