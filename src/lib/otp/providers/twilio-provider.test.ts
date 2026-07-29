import { describe, it, expect, vi, afterEach } from "vitest";

// Phase D.4 — regression tests for TwilioOtpProvider: confirms the SMS
// vs. WhatsApp channel prefixing, that credentials are sent via a
// Basic Auth header (never in the body/URL), that the OTP code itself
// only ever appears in the message Body (never logged), and that a
// non-2xx Twilio response surfaces a useful error without leaking the
// auth token.

vi.mock("server-only", () => ({}));

const { TwilioOtpProvider } = await import("./twilio-provider");

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response> & { ok: boolean }) {
  vi.stubGlobal("fetch", fetchMock.mockResolvedValue(response));
}

describe("TwilioOtpProvider", () => {
  it("sends a plain SMS request with Basic Auth and no whatsapp: prefix", async () => {
    stubFetch({ ok: true });
    const provider = new TwilioOtpProvider({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+14155550100",
      channel: "sms",
    });

    await provider.send({ phoneNumber: "+15005550006", code: "123456" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("AC123:secret-token").toString("base64")}`
    );

    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("+15005550006");
    expect(body.get("From")).toBe("+14155550100");
    expect(body.get("Body")).toContain("123456");
  });

  it("prefixes both To and From with whatsapp: when channel is whatsapp", async () => {
    stubFetch({ ok: true });
    const provider = new TwilioOtpProvider({
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+14155238886",
      channel: "whatsapp",
    });

    await provider.send({ phoneNumber: "+15005550006", code: "654321" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("whatsapp:+15005550006");
    expect(body.get("From")).toBe("whatsapp:+14155238886");
  });

  it("throws a descriptive error, without the auth token, on a non-2xx response", async () => {
    stubFetch({
      ok: false,
      status: 401,
      json: async () => ({ code: 20003, message: "Authentication Error" }),
    } as Response);

    const provider = new TwilioOtpProvider({
      accountSid: "AC123",
      authToken: "super-secret-token",
      fromNumber: "+14155550100",
      channel: "sms",
    });

    await expect(provider.send({ phoneNumber: "+15005550006", code: "111111" })).rejects.toThrow(
      /HTTP 401.*20003.*Authentication Error/
    );

    const thrown = await provider
      .send({ phoneNumber: "+15005550006", code: "111111" })
      .catch((error: Error) => error.message);
    expect(thrown).not.toContain("super-secret-token");
  });
});
