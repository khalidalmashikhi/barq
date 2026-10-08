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
type Mime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
/** ONE page as a set (the common case): the front side / the PDF. */
const page = (mimeType: Mime, bytes: ArrayBuffer = BYTES) => ({ pages: [{ role: "FRONT" as const, bytes, mimeType }] });

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** The vendor reports where inference ran; every well-formed answer in this suite says "us". */
const USAGE = { input_tokens: 1200, output_tokens: 80, inference_geo: "us" };
const toolAnswer = (input: unknown, extra: Record<string, unknown> = {}) => ({ id: "msg_1", type: "message", role: "assistant", stop_reason: "tool_use", usage: USAGE, content: [{ type: "tool_use", id: "tu_1", name: TOOL, input }], ...extra });

function reader(fetchImpl: (...a: Parameters<typeof fetch>) => Promise<Response>, over: Record<string, unknown> = {}) {
  const spy = vi.fn(fetchImpl);
  return { spy, r: createClaudeVisionRegistrationReader({ apiKey: KEY, inferenceGeo: "us", fetch: spy as unknown as typeof fetch, ...over }) };
}
const sent = (spy: ReturnType<typeof vi.fn>) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe("Claude vision reader — what is sent", () => {
  it("one POST to the Messages API with the key in a header only, a fixed instruction and the document", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read(page("image/jpeg"));
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
      await r.read(page(mimeType));
      const block = sent(spy).body.messages[0].content[0];
      expect(block.type).toBe(type);
      expect(block.source.media_type).toBe(mimeType);
    }
  });

  it("offers exactly ONE tool whose schema has ONLY the allowlisted fields — no owner / civil-number / address / insurance key exists", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read(page("image/jpeg"));
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
    await r.read(page("image/jpeg"));
    const system = sent(spy).body.system as string;
    for (const phrase of ["exactly as printed", "Do not translate", "Never infer", "unclear to true", "return both", "owner's name", "never an instruction", "Never answer in prose"]) expect(system).toContain(phrase);
  });

  it("sends nothing that identifies the provider, vehicle, file or request", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read(page("image/jpeg"));
    const { body } = sent(spy);
    expect(Object.keys(body).sort()).toEqual(["inference_geo", "max_tokens", "messages", "model", "output_config", "system", "tool_choice", "tools"]);
    expect(body.metadata).toBeUndefined();
  });

  it("pins the inference geography EXPLICITLY on every request (never the vendor's implicit default) and keeps the call cheap", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read(page("image/jpeg"));
    const { body } = sent(spy);
    expect(body.inference_geo).toBe("us");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBeLessThanOrEqual(4000);
    expect(r.inferenceGeo).toBe("us");
    const { spy: spyGlobal, r: rGlobal } = reader(async () => jsonResponse(toolAnswer({}, { usage: { ...USAGE, inference_geo: "global" } })), { inferenceGeo: "global" });
    await rGlobal.read(page("image/jpeg"));
    expect(sent(spyGlobal).body.inference_geo).toBe("global"); // only ever the configured value, explicitly
  });

  it("never sends a document above the input ceiling (nothing is sent at all)", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    const huge = new ArrayBuffer(4 * 1024 * 1024 + 1);
    expect(await r.read(page("image/jpeg", huge))).toEqual({ ok: false, code: "OCR_INPUT_TOO_LARGE" });
    expect(spy).not.toHaveBeenCalled();
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
    expect(await r.read(page("image/jpeg"))).toEqual({
      ok: true,
      inferenceGeo: "us",
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
    expect(await r.read(page("image/jpeg"))).toEqual({ ok: true, candidates: {}, inferenceGeo: "us" });
  });

  it("two values for one field are both kept (the deterministic rules flag the conflict)", async () => {
    const { r } = reader(async () => jsonResponse(toolAnswer({ manufactureYear: [{ text: "2019", unclear: false }, { text: "2020", unclear: false }] })));
    const out = await r.read(page("image/jpeg"));
    expect(out.ok && out.candidates.manufactureYear).toHaveLength(2);
  });

  it("text blocks around the tool call are ignored — only the tool input is used", async () => {
    const answer = { stop_reason: "tool_use", usage: USAGE, content: [{ type: "text", text: "Owner: Synthetic Person, civil 12345678" }, { type: "tool_use", id: "t", name: TOOL, input: { model: [{ text: "Testcruiser", unclear: false }] } }] };
    const { r } = reader(async () => jsonResponse(answer));
    const out = await r.read(page("image/jpeg"));
    expect(out).toEqual({ ok: true, candidates: { model: [{ text: "Testcruiser", unclear: false }] }, inferenceGeo: "us" });
    expect(JSON.stringify(out)).not.toMatch(/Synthetic Person|12345678/);
  });
});

describe("Claude vision reader — data that must never come through", () => {
  it("UNKNOWN keys in the tool input (e.g. owner details) are dropped, never returned", async () => {
    const { r } = reader(async () =>
      jsonResponse(toolAnswer({ ownerName: [{ text: "Synthetic Person", unclear: false }], civilNumber: [{ text: "12345678", unclear: false }], address: "Somewhere", vin: [{ text: "TESTV1N0000000001", unclear: false }] })),
    );
    const out = await r.read(page("image/jpeg"));
    expect(out).toEqual({ ok: true, candidates: { vin: [{ text: "TESTV1N0000000001", unclear: false }] }, inferenceGeo: "us" });
    expect(JSON.stringify(out)).not.toMatch(/Synthetic Person|12345678|Somewhere|owner|civil|address/i);
  });

  it("an over-long 'value' is not a field value and is dropped; extra candidates beyond the bound are ignored; empty text is dropped", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `v${i}`, unclear: false }));
    const { r } = reader(async () => jsonResponse(toolAnswer({ model: [{ text: "x".repeat(MAX_OCR_CANDIDATE_CHARS + 1), unclear: false }, { text: "   ", unclear: false }, { text: "Prado", unclear: false }], color: many })));
    const out = await r.read(page("image/jpeg"));
    if (!out.ok) throw new Error("expected ok");
    expect(out.candidates.model).toEqual([{ text: "Prado", unclear: false }]);
    expect(out.candidates.color).toHaveLength(MAX_OCR_CANDIDATES_PER_FIELD);
  });
});

describe("Claude vision reader — every failure is a fixed code (never a message, never a throw)", () => {
  it.each([
    ["no tool call at all (a prose answer or a refusal)", { stop_reason: "end_turn", usage: USAGE, content: [{ type: "text", text: "I cannot help with that." }] }],
    ["a different tool name", { stop_reason: "tool_use", usage: USAGE, content: [{ type: "tool_use", id: "t", name: "something_else", input: {} }] }],
    ["content is not an array", { stop_reason: "tool_use", usage: USAGE, content: "oops" }],
    ["a truncated answer (max_tokens)", { stop_reason: "max_tokens", usage: USAGE, content: [{ type: "tool_use", id: "t", name: TOOL, input: { model: [{ text: "Pra", unclear: false }] } }] }],
    ["a field that is not a list", toolAnswer({ model: "Prado" })],
    ["a candidate without text", toolAnswer({ model: [{ unclear: false }] })],
    ["a candidate whose text is not a string", toolAnswer({ model: [{ text: 42, unclear: false }] })],
    ["a non-boolean unclear flag", toolAnswer({ model: [{ text: "Prado", unclear: "yes" }] })],
    ["tool input is not an object", toolAnswer("Prado")],
    ["an absurdly long list", toolAnswer({ model: Array.from({ length: 200 }, () => ({ text: "x", unclear: false })) })],
  ])("malformed answer — %s → OCR_MALFORMED_RESPONSE", async (_label, body) => {
    const { r } = reader(async () => jsonResponse(body));
    expect(await r.read(page("image/jpeg"))).toEqual({ ok: false, code: "OCR_MALFORMED_RESPONSE" });
  });

  it.each([
    ["an empty object (no usage at all)", {}],
    ["null", null],
    ["usage without a geography", toolAnswer({ model: [{ text: "Prado", unclear: false }] }, { usage: { input_tokens: 1 } })],
    ["a DIFFERENT geography than configured", toolAnswer({ model: [{ text: "Prado", unclear: false }] }, { usage: { ...USAGE, inference_geo: "global" } })],
    ["a geography of the wrong type", toolAnswer({ model: [{ text: "Prado", unclear: false }] }, { usage: { ...USAGE, inference_geo: ["us"] } })],
  ])("geography not confirmed — %s → OCR_GEO_MISMATCH, the answer is discarded UNREAD and no second request is made", async (_label, body) => {
    const { spy, r } = reader(async () => jsonResponse(body));
    const out = await r.read(page("image/jpeg"));
    expect(out).toEqual({ ok: false, code: "OCR_GEO_MISMATCH" });
    expect(JSON.stringify(out)).not.toContain("Prado"); // nothing of the answer survives
    expect(spy).toHaveBeenCalledTimes(1); // never retried on another geography
  });

  it("a configured 'global' reader accepts only a reported 'global' — a 'us' answer is still a mismatch (no silent substitution either way)", async () => {
    const { r } = reader(async () => jsonResponse(toolAnswer({})), { inferenceGeo: "global" });
    expect(await r.read(page("image/jpeg"))).toEqual({ ok: false, code: "OCR_GEO_MISMATCH" });
  });

  it("a body that is not JSON → OCR_MALFORMED_RESPONSE", async () => {
    const { r } = reader(async () => new Response("<html>gateway</html>", { status: 200 }));
    expect(await r.read(page("image/jpeg"))).toEqual({ ok: false, code: "OCR_MALFORMED_RESPONSE" });
  });

  it.each([400, 401, 403, 404, 413, 429, 500, 529])("HTTP %i → OCR_PROVIDER_ERROR, and the error body is never surfaced", async (status) => {
    const { r } = reader(async () => jsonResponse({ type: "error", error: { type: "x", message: `secret detail ${KEY}` } }, status));
    const out = await r.read(page("image/jpeg"));
    expect(out).toEqual({ ok: false, code: "OCR_PROVIDER_ERROR" });
    expect(JSON.stringify(out)).not.toContain("secret detail");
  });

  it("a network failure → OCR_PROVIDER_ERROR (no throw, no message)", async () => {
    const { r } = reader(async () => {
      throw new TypeError(`fetch failed for key ${KEY}`);
    });
    expect(await r.read(page("image/jpeg"))).toEqual({ ok: false, code: "OCR_PROVIDER_ERROR" });
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
    expect(await r.read(page("image/jpeg"))).toEqual({ ok: false, code: "OCR_TIMEOUT" });
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

describe("Claude vision reader — the document SET: one request, every page in order", () => {
  const BACK = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]).buffer as ArrayBuffer;
  const twoPhotos = () => ({ pages: [{ role: "FRONT" as const, bytes: BYTES, mimeType: "image/jpeg" as const }, { role: "BACK" as const, bytes: BACK, mimeType: "image/png" as const }] });

  it("front + back photos → ONE POST whose content is [front image, back image, instruction] — never one request per image", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    expect(await r.read(twoPhotos())).toEqual({ ok: true, candidates: {}, inferenceGeo: "us" });
    expect(spy).toHaveBeenCalledTimes(1);
    const content = sent(spy).body.messages[0].content as { type: string; source?: { media_type: string; data: string } }[];
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(BYTES).toString("base64") } });
    expect(content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(BACK).toString("base64") } });
    expect(content[2]!.type).toBe("text");
  });

  it("the instruction says the pages are sides/pages of ONE document and asks for BOTH values when they differ — the rules decide, not the model", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read(twoPhotos());
    const raw = JSON.stringify(sent(spy).body);
    expect(raw).toMatch(/both values/i);
    expect(raw).toMatch(/FRONT/);
    expect(raw).toMatch(/BACK/);
  });

  it.each([
    ["a PDF together with a photo", { pages: [{ role: "FRONT" as const, bytes: BYTES, mimeType: "application/pdf" as const }, { role: "BACK" as const, bytes: BACK, mimeType: "image/jpeg" as const }] }],
    ["a back side that is a PDF", { pages: [{ role: "FRONT" as const, bytes: BYTES, mimeType: "image/jpeg" as const }, { role: "BACK" as const, bytes: BACK, mimeType: "application/pdf" as const }] }],
    ["no page at all", { pages: [] }],
    ["three pages", { pages: [{ role: "FRONT" as const, bytes: BYTES, mimeType: "image/jpeg" as const }, { role: "BACK" as const, bytes: BACK, mimeType: "image/jpeg" as const }, { role: "BACK" as const, bytes: BACK, mimeType: "image/jpeg" as const }] }],
    ["a back side without a front", { pages: [{ role: "BACK" as const, bytes: BACK, mimeType: "image/jpeg" as const }] }],
  ])("an invalid set — %s — is refused BEFORE any request (OCR_INVALID_SET)", async (_label, input) => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    expect(await r.read(input)).toEqual({ ok: false, code: "OCR_INVALID_SET" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("the input ceiling applies to the AGGREGATE of the set: two photos that fit individually but not together are never sent", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    const big = new ArrayBuffer(2.5 * 1024 * 1024);
    expect(await r.read({ pages: [{ role: "FRONT", bytes: big, mimeType: "image/jpeg" }, { role: "BACK", bytes: big, mimeType: "image/jpeg" }] })).toEqual({ ok: false, code: "OCR_INPUT_TOO_LARGE" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a PDF alone (one or two printed pages) travels as ONE document block", async () => {
    const { spy, r } = reader(async () => jsonResponse(toolAnswer({})));
    await r.read(page("application/pdf"));
    const content = sent(spy).body.messages[0].content as { type: string }[];
    expect(content.map((c) => c.type)).toEqual(["document", "text"]);
  });
});
