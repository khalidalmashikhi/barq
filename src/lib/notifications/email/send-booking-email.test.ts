import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// BOOKING NOTIFICATION DELIVERY — the config-gated Resend sender. Proves the disabled default, the
// console path, HTTP success/id, and the retryable-vs-terminal classification — without ever
// hitting the network (fetch is mocked).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { sendBookingEmail } = await import("./send-booking-email");

const OLD_ENV = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.BOOKING_EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "BARQ <noreply@barq.example>";
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
});

const MSG = { to: "user@example.com", subject: "s", html: "<p>h</p>", text: "t" };

describe("sendBookingEmail", () => {
  it("is DISABLED (no fetch) when BOOKING_EMAIL_PROVIDER is unset/disabled", async () => {
    process.env.BOOKING_EMAIL_PROVIDER = "disabled";
    const r = await sendBookingEmail(MSG);
    expect(r).toEqual({ ok: false, retryable: false, errorClass: "DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("console provider succeeds without a network call", async () => {
    process.env.BOOKING_EMAIL_PROVIDER = "console";
    const r = await sendBookingEmail(MSG);
    expect(r).toEqual({ ok: true, providerMessageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to DISABLED when resend is selected but creds are missing", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await sendBookingEmail(MSG);
    expect(r).toEqual({ ok: false, retryable: false, errorClass: "DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the provider id on a 2xx", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "resend_123" }) });
    expect(await sendBookingEmail(MSG)).toEqual({ ok: true, providerMessageId: "resend_123" });
  });

  it("classifies 429 and 5xx as RETRYABLE", async () => {
    for (const status of [429, 500, 502, 503]) {
      fetchMock.mockResolvedValue({ ok: false, status });
      expect(await sendBookingEmail(MSG)).toEqual({ ok: false, retryable: true, errorClass: `HTTP_${status}` });
    }
  });

  it("classifies 4xx (bad address/auth) as TERMINAL", async () => {
    for (const status of [400, 401, 403, 422]) {
      fetchMock.mockResolvedValue({ ok: false, status });
      expect(await sendBookingEmail(MSG)).toEqual({ ok: false, retryable: false, errorClass: `HTTP_${status}` });
    }
  });

  it("classifies a thrown network error as RETRYABLE, leaking nothing", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.resend.com"));
    expect(await sendBookingEmail(MSG)).toEqual({ ok: false, retryable: true, errorClass: "NETWORK" });
  });

  it("never puts the recipient address in the error class", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422 });
    const r = await sendBookingEmail(MSG);
    expect(JSON.stringify(r)).not.toContain("user@example.com");
  });
});
