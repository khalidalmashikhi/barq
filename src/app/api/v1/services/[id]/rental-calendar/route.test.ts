import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const resolveMock = vi.fn();
vi.mock("@/lib/offerings/rental/resolve-rental-service-calendar", () => ({
  resolveRentalServiceCalendar: (...args: unknown[]) => resolveMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => resolveMock.mockReset());

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs = "") => new Request(`http://localhost/api/v1/services/s1/rental-calendar${qs}`);

const CAL = {
  serviceId: "s1",
  currency: "OMR",
  window: { from: "2030-07-01", to: "2030-07-02", timeZone: "Asia/Muscat" },
  offerings: [],
  lowestAvailableDailyRate: null,
  availabilityBasis: "CONFIGURED",
};

describe("GET /api/v1/services/{id}/rental-calendar", () => {
  it("passes serviceId + from/to to the resolver and returns the calendar with no-store", async () => {
    resolveMock.mockResolvedValue({ ok: true, calendar: CAL });
    const res = await GET(req("?from=2030-07-01&to=2030-07-02"), params("s1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(resolveMock).toHaveBeenCalledWith({}, { serviceId: "s1", from: "2030-07-01", to: "2030-07-02" });
    expect(await res.json()).toEqual(CAL);
  });

  it("omits from/to as undefined when absent (resolver applies its default window)", async () => {
    resolveMock.mockResolvedValue({ ok: true, calendar: CAL });
    await GET(req(), params("s1"));
    expect(resolveMock).toHaveBeenCalledWith({}, { serviceId: "s1", from: undefined, to: undefined });
  });

  it("maps INVALID_WINDOW → 400 INVALID_INPUT", async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: "INVALID_WINDOW" });
    const res = await GET(req("?from=x&to=y"), params("s1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("maps NOT_PUBLIC → 404 NOT_FOUND (non-enumerating; body reveals no cause)", async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: "NOT_PUBLIC" });
    const res = await GET(req("?from=2030-07-01&to=2030-07-02"), params("s1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toMatch(/provider|vertical|vehicle|offering|compliance/i);
  });

  it("maps READ_FAILED → 500 INTERNAL_ERROR (safe)", async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: "READ_FAILED" });
    const res = await GET(req("?from=2030-07-01&to=2030-07-02"), params("s1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
