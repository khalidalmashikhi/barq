import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { ResendEmailProvider } = await import("./resend-email-provider");

const CONFIG = { apiKey: "re_secret_key_value", from: "BARQ <noreply@barq.example>" };
const PARAMS = { email: "customer@example.com", code: "482913", type: "sign-in" as const };

afterEach(() => vi.restoreAllMocks());

describe("ResendEmailProvider", () => {
  it("POSTs to the Resend API with the Bearer key and a well-formed OTP email", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "email-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ResendEmailProvider(CONFIG).send(PARAMS)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_secret_key_value");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe(CONFIG.from);
    expect(body.to).toEqual(["customer@example.com"]);
    expect(body.subject).toBeTruthy();
    expect(body.text).toContain("482913"); // the code is delivered in the email body
    expect(body.html).toContain("482913");
  });

  it("fails closed on a non-2xx response and NEVER leaks the api key, the code, or the recipient", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ name: "validation_error", message: "from is not a verified domain" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await new ResendEmailProvider(CONFIG).send(PARAMS);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // Useful diagnostics (status + resend error) but no secret / OTP / recipient.
    expect(message).toContain("422");
    expect(message).toContain("validation_error");
    expect(message).not.toContain(CONFIG.apiKey);
    expect(message).not.toContain("482913");
    expect(message).not.toContain("customer@example.com");
  });

  it("propagates a network failure (fetch rejects) as a thrown error — never a silent success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(new ResendEmailProvider(CONFIG).send(PARAMS)).rejects.toThrow();
  });
});
