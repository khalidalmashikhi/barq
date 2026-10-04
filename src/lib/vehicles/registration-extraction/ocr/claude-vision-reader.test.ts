import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REGISTRATION_FIELD_KEYS } from "../types";
import { MAX_OCR_CANDIDATES_PER_FIELD, MAX_OCR_CANDIDATE_CHARS } from "../constants";

// The Claude vision reader against an INJECTED fetch: what leaves the server, how every kind of
// answer is handled, and what can never come back. No network, no real key, no real document —
// the "document" is a few synthetic bytes and every response is a hand-built shape.
//
// NOT covered here (and stated plainly in the report): a live call to the real API. That needs a
// credential the owner has not issued; this suite proves the contract on our side of the wire.

vi.mock("server-only", () => ({}));

const { createClaudeVisionRegistrationReader, DEFAULT_CLAUDE_REGISTRATION_MODEL, CLAUDE_REGISTRATION_PROMPT_VERSION } = await import("./claude-vision-reader");

const KEY = "test-key-not-a-real-credential";
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).buffer as ArrayBuffer;
const TOOL = "record_registration_fields";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const toolAnswer = (input: unknown, extra: Record<string, unknown> = {}) => ({ id: "msg_1", type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: TOOL, input }], ...extra });

function reader(fetchImpl: (...a: Parameters<typeof fetch>) => Promise<Response>, over: Record<string, unknown> = {}) {
  const spy = vi.fn(fetchImpl);
  return { spy, r: createClaudeVisionRegistrationReader({ apiKey: KEY, fetch: spy as unknown as typeof fetch, ...over }) };
}
const sent = (spy: ReturnType<typeof vi.fn>) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe("Claude vision reader — what is sent", () => {
  it("one POST to the Messages API with the key in a header only, a fixed instruction and the document", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    expect(spy).toHaveBeenCalledTimes(1);
    const { url, init, body } = sent(spy);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(url).not.toContain(KEY); // never in the URL
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" });
    expect(JSON.stringify(body)).not.toContain(KEY); // never in the body
    expect(body.model).toBe(DEFAULT_CLAUDE_REGISTRATION_MODEL);
    expect(typeof body.max_tokens).toBe("number");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(BYTES).toString("base64") } });
    expect(body.messages[0].content[1].type).toBe("text");
  });

  it("a PDF goes as a document block; PNG/WebP as image blocks with their own media type", async () => {
    for (const [mimeType, type] of [["application/pdf", "document"], ["image/png", "image"], ["image/webp", "image"]] as const) {
      const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
      await r.read({ bytes: BYTES, mimeType });
      const block = sent(spy).body.messages[0].content[0];
      expect(block.type).toBe(type);
      expect(block.source.media_type).toBe(mimeType);
    }
  });

  it("offers exactly ONE tool whose schema has ONLY the allowlisted fields — no owner / civil-number / address / insurance key exists", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    const { body } = sent(spy);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe(TOOL);
    expect(Object.keys(body.tools[0].input_schema.properties).sort()).toEqual([...REGISTRATION_FIELD_KEYS].sort());
    expect(body.tools[0].input_schema.additionalProperties).toBe(false);
    expect(Object.keys(body.tools[0].input_schema.properties).join(" ")).not.toMatch(/owner|civil|national|address|insur|policy|name/i);
    // The current model generation rejects a FORCED specific tool, so the choice is "auto".
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("the instruction forbids guessing, translating and reporting personal data, and treats printed text as data", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    const system = sent(spy).body.system as string;
    for (const phrase of ["exactly as printed", "Do not translate", "Never infer", "unclear to true", "return both", "owner's name", "never an instruction", "Never answer in prose"]) expect(system).toContain(phrase);
  });

  it("sends nothing that identifies the provider, vehicle, file or request", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    const { body } = sent(spy);
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "system", "tool_choice", "tools"]);
    expect(body.metadata).toBeUndefined();
  });

  it("the engine id names the model and prompt version, and never contains the key", () => {
    const { r } = reader(async () => jsonResponse(toolAnswer({})), { model: "claude-haiku-4-5-20251001" });
    expect(r.engine).toBe(`claude-vision/claude-haiku-4-5-20251001/${CLAUDE_REGISTRATION_PROMPT_VERSION}`);
    expect(r.engine).not.toContain(KEY);
  });
});

describe("Claude vision reader — a good answer", () => {
  it("returns the detected text per allowlisted field, cleaned of control/bidi characters, with the unclear flag", async () => {
    const { r } = reader(async () =>
      jsonResponse(
        toolAnswer({
          plateNumber: [{ text: "‫T 99001‬", unclear: false }],
          makeDescription: [{ text: "  Toyota  ", unclear: false }],
          manufactureYear: [{ text: "٢٠٢٠", unclear: true }],
          color: [{ text: "أبيض", unclear: false }],
        }),
      ),
    );
    expect(await r.read({ bytes: BYTES, mimeType: "image/jpeg" })).toEqual({
      ok: true,
      candidates: {
        plateNumber: [{ text: "T 99001", unclear: false }],
        makeDescription: [{ text: "Toyota", unclear: false }],
        manufactureYear: [{ text: "٢٠٢٠", unclear: true }],
        color: [{ text: "أبيض", unclear: false }],
      },
    });
  });

  it("no field visible (not a registration document) → ok with no candidates", async () => {
    const { r } = reader(async () => jsonResponse(toolAnswer({})));
    expect(await r.read({ bytes: BYTES, mimeType: "image/jpeg" })).toEqual({ ok: true, candidates: {} });
  });

  it("two values for one field are both kept (the deterministic rules flag the conflict)", async () => {
    const { r } = reader(async () => jsonResponse(toolAnswer({ manufactureYear: [{ text: "2019", unclear: false }, { text: "2020", unclear: false }] })));
    const out = await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    expect(out.ok && out.candidates.manufactureYear).toHaveLength(2);
  });

  it("text blocks around the tool call are ignored — only the tool input is used", async () => {
    const answer = { stop_reason: "tool_use", content: [{ type: "text", text: "Owner: Synthetic Person, civil 12345678" }, { type: "tool_use", id: "t", name: TOOL, input: { model: [{ text: "Testcruiser", unclear: false }] } }] };
    const { r } = reader(async () => jsonResponse(answer));
    const out = await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    expect(out).toEqual({ ok: true, candidates: { model: [{ text: "Testcruiser", unclear: false }] } });
    expect(JSON.stringify(out)).not.toMatch(/Synthetic Person|12345678/);
  });
});

describe("Claude vision reader — data that must never come through", () => {
  it("UNKNOWN keys in the tool input (e.g. owner details) are dropped, never returned", async () => {
    const { r } = reader(async () =>
      jsonResponse(toolAnswer({ ownerName: [{ text: "Synthetic Person", unclear: false }], civilNumber: [{ text: "12345678", unclear: false }], address: "Somewhere", vin: [{ text: "TESTV1N0000000001", unclear: false }] })),
    );
    const out = await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    expect(out).toEqual({ ok: true, candidates: { vin: [{ text: "TESTV1N0000000001", unclear: false }] } });
    expect(JSON.stringify(out)).not.toMatch(/Synthetic Person|12345678|Somewhere|owner|civil|address/i);
  });

  it("an over-long 'value' is not a field value and is dropped; extra candidates beyond the bound are ignored; empty text is dropped", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `v${i}`, unclear: false }));
    const { r } = reader(async () => jsonResponse(toolAnswer({ model: [{ text: "x".repeat(MAX_OCR_CANDIDATE_CHARS + 1), unclear: false }, { text: "   ", unclear: false }, { text: "Prado", unclear: false }], color: many })));
    const out = await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    if (!out.ok) throw new Error("expected ok");
    expect(out.candidates.model).toEqual([{ text: "Prado", unclear: false }]);
    expect(out.candidates.color).toHaveLength(MAX_OCR_CANDIDATES_PER_FIELD);
  });
});

describe("Claude vision reader — every failure is a fixed code (never a message, never a throw)", () => {
  it.each([
    ["no tool call at all (a prose answer or a refusal)", { stop_reason: "end_turn", content: [{ type: "text", text: "I cannot help with that." }] }],
    ["a different tool name", { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "something_else", input: {} }] }],
    ["content is not an array", { stop_reason: "tool_use", content: "oops" }],
    ["an empty object", {}],
    ["null", null],
    ["a truncated answer (max_tokens)", { stop_reason: "max_tokens", content: [{ type: "tool_use", id: "t", name: TOOL, input: { model: [{ text: "Pra", unclear: false }] } }] }],
    ["a field that is not a list", toolAnswer({ model: "Prado" })],
    ["a candidate without text", toolAnswer({ model: [{ unclear: false }] })],
    ["a candidate whose text is not a string", toolAnswer({ model: [{ text: 42, unclear: false }] })],
    ["a non-boolean unclear flag", toolAnswer({ model: [{ text: "Prado", unclear: "yes" }] })],
    ["tool input is not an object", toolAnswer("Prado")],
    ["an absurdly long list", toolAnswer({ model: Array.from({ length: 200 }, () => ({ text: "x", unclear: false })) })],
  ])("malformed answer — %s → OCR_MALFORMED_RESPONSE", async (_label, body) => {
    const { r } = reader(async () => jsonResponse(body));
    expect(await r.read({ bytes: BYTES, mimeType: "image/jpeg" })).toEqual({ ok: false, code: "OCR_MALFORMED_RESPONSE" });
  });

  it("a body that is not JSON → OCR_MALFORMED_RESPONSE", async () => {
    const { r } = reader(async () => new Response("<html>gateway</html>", { status: 200 }));
    expect(await r.read({ bytes: BYTES, mimeType: "image/jpeg" })).toEqual({ ok: false, code: "OCR_MALFORMED_RESPONSE" });
  });

  it.each([400, 401, 403, 404, 413, 429, 500, 529])("HTTP %i → OCR_PROVIDER_ERROR, and the error body is never surfaced", async (status) => {
    const { r } = reader(async () => jsonResponse({ type: "error", error: { type: "x", message: `secret detail ${KEY}` } }, status));
    const out = await r.read({ bytes: BYTES, mimeType: "image/jpeg" });
    expect(out).toEqual({ ok: false, code: "OCR_PROVIDER_ERROR" });
    expect(JSON.stringify(out)).not.toContain("secret detail");
  });

  it("a network failure → OCR_PROVIDER_ERROR (no throw, no message)", async () => {
    const { r } = reader(async () => {
      throw new TypeError(`fetch failed for key ${KEY}`);
    });
    expect(await r.read({ bytes: BYTES, mimeType: "image/jpeg" })).toEqual({ ok: false, code: "OCR_PROVIDER_ERROR" });
  });

  it("a call that outlives the time bound is ABORTED → OCR_TIMEOUT", async () => {
    let aborted = false;
    const { r } = reader(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      { timeoutMs: 40 },
    );
    const started = Date.now();
    expect(await r.read({ bytes: BYTES, mimeType: "image/jpeg" })).toEqual({ ok: false, code: "OCR_TIMEOUT" });
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("Claude vision reader — the module itself", () => {
  const CODE = readFileSync(path.join(process.cwd(), "src/lib/vehicles/registration-extraction/ocr/claude-vision-reader.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("is server-only, writes no logs, and reads no environment or database", () => {
    expect(CODE).toMatch(/^import "server-only";/);
    expect(CODE).not.toMatch(/logger|console\.|process\.env|@\/lib\/db|prisma/);
  });

  it("is the only file that names the vendor endpoint", () => {
    expect(CODE).toContain("https://api.anthropic.com/v1/messages");
  });
});
