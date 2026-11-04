import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Lifecycle of the PDF engine around the parse budget (fictional data, no real PDF engine):
// - loading the engine module is dependency loading, not parsing: it must not count against the
//   parse timeout, and it is loaded once and reused;
// - every loading task is destroyed exactly once, including one that appears or settles AFTER the
//   timeout, and its late
//   rejection is consumed (never an unhandled rejection).

vi.mock("server-only", () => ({}));
const engine = vi.hoisted(() => ({ getResolvedPDFJS: vi.fn() }));
vi.mock("unpdf", () => ({ getResolvedPDFJS: engine.getResolvedPDFJS }));

type PdfText = typeof import("./pdf-text");
type Deps = NonNullable<Parameters<PdfText["extractPdfText"]>[2]>;

const enc = (s: string) => new TextEncoder().encode(s).buffer;
const PDF_HEADER = () => enc("%PDF-1.4\n% stub body with enough bytes for a head check\n%%EOF\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Lets queued promise callbacks and Node's unhandled-rejection check run.
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const DOC = {
  numPages: 1,
  getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Plate Number: A 12345", hasEOL: true }] }), cleanup: () => {} }),
};

// A loading task whose promise is NOT pre-handled: an unobserved rejection stays visible.
function rawTask() {
  const d = deferred<typeof DOC>();
  return { task: { promise: d.promise, destroy: vi.fn() }, settle: d };
}

// Tests that inject their own deps never load the engine: they share one module instance.
const shared = await import("./pdf-text");

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  engine.getResolvedPDFJS.mockReset();
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

describe("extractPdfText — engine loading is outside the parse budget", () => {
  // A fresh module per test so the engine cache starts empty. Loading modules through the test
  // runner is slow when many workers run in parallel, so it happens here, in a hook with its own
  // generous limit, and the (mocked) engine module is loaded before the test body starts.
  let fresh: PdfText;
  beforeEach(async () => {
    vi.resetModules();
    await import("unpdf");
    fresh = await import("./pdf-text");
  }, 120_000);

  it("an engine that finishes loading after the budget has elapsed is not reported as PARSER_TIMEOUT", async () => {
    const { extractPdfText } = fresh;
    const engineReady = deferred<{ getDocument: () => unknown }>();
    engine.getResolvedPDFJS.mockReturnValue(engineReady.promise);

    let settled: unknown;
    const pending = extractPdfText(PDF_HEADER(), { timeoutMs: 20 }).then((r) => (settled = r));
    await sleep(100); // five budgets pass while the engine is still loading
    expect(settled).toBeUndefined();

    const { task, settle } = rawTask();
    engineReady.resolve({ getDocument: () => task });
    settle.resolve(DOC);
    await pending;
    expect(settled).toMatchObject({ ok: true, pageCount: 1 });
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it("the engine is loaded once and reused across parses", async () => {
    const { extractPdfText } = fresh;
    const tasks: ReturnType<typeof rawTask>[] = [];
    engine.getResolvedPDFJS.mockResolvedValue({
      getDocument: () => {
        const t = rawTask();
        t.settle.resolve(DOC);
        tasks.push(t);
        return t.task;
      },
    });

    expect((await extractPdfText(PDF_HEADER())).ok).toBe(true);
    expect((await extractPdfText(PDF_HEADER())).ok).toBe(true);
    expect(engine.getResolvedPDFJS).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(2);
    for (const t of tasks) expect(t.task.destroy).toHaveBeenCalledTimes(1);
  });

  it("an engine that fails to load → EXTRACTION_FAILED (never a throw), and the next parse retries the load", async () => {
    const { extractPdfText } = fresh;
    engine.getResolvedPDFJS.mockRejectedValueOnce(new Error("module load failed"));
    expect(await extractPdfText(PDF_HEADER())).toEqual({ ok: false, code: "EXTRACTION_FAILED" });

    const { task, settle } = rawTask();
    settle.resolve(DOC);
    engine.getResolvedPDFJS.mockResolvedValueOnce({ getDocument: () => task });
    expect((await extractPdfText(PDF_HEADER())).ok).toBe(true);
    expect(engine.getResolvedPDFJS).toHaveBeenCalledTimes(2);
    await flush();
    expect(unhandled).toEqual([]);
  });
});

describe("extractPdfText — a loading task that outlives the timeout", () => {
  it("a task created AFTER the timeout that later resolves is destroyed exactly once", async () => {
    const { extractPdfText } = shared;
    const created = deferred<Awaited<ReturnType<Deps["getDocument"]>>>();
    const deps: Deps = { getDocument: () => created.promise };

    expect(await extractPdfText(PDF_HEADER(), { timeoutMs: 20 }, deps)).toEqual({ ok: false, code: "PARSER_TIMEOUT" });

    const { task, settle } = rawTask();
    created.resolve(task);
    settle.resolve(DOC);
    await flush();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });

  it("a task created AFTER the timeout that later rejects is destroyed exactly once and its rejection is consumed", async () => {
    const { extractPdfText } = shared;
    const created = deferred<Awaited<ReturnType<Deps["getDocument"]>>>();
    const deps: Deps = { getDocument: () => created.promise };

    expect(await extractPdfText(PDF_HEADER(), { timeoutMs: 20 }, deps)).toEqual({ ok: false, code: "PARSER_TIMEOUT" });

    const { task, settle } = rawTask();
    created.resolve(task);
    settle.reject(Object.assign(new Error("No password given"), { name: "PasswordException" }));
    await flush();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });

  it("getDocument itself rejecting after the timeout is consumed", async () => {
    const { extractPdfText } = shared;
    const created = deferred<Awaited<ReturnType<Deps["getDocument"]>>>();
    const deps: Deps = { getDocument: () => created.promise };

    expect(await extractPdfText(PDF_HEADER(), { timeoutMs: 20 }, deps)).toEqual({ ok: false, code: "PARSER_TIMEOUT" });

    created.reject(new Error("late failure"));
    await flush();
    expect(unhandled).toEqual([]);
  });

  it("a task created BEFORE the timeout whose promise rejects after it is destroyed exactly once and consumed", async () => {
    const { extractPdfText } = shared;
    const { task, settle } = rawTask();
    const deps: Deps = { getDocument: async () => task };

    expect(await extractPdfText(PDF_HEADER(), { timeoutMs: 20 }, deps)).toEqual({ ok: false, code: "PARSER_TIMEOUT" });
    expect(task.destroy).toHaveBeenCalled();

    settle.reject(new Error("Loading aborted"));
    await flush();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });
});

describe("extractPdfText — every created task is destroyed exactly once", () => {
  const cases: Array<[string, (s: ReturnType<typeof rawTask>["settle"]) => void, Record<string, number>, string]> = [
    ["success", (s) => s.resolve(DOC), {}, "ok"],
    ["page limit", (s) => s.resolve({ ...DOC, numPages: 20 }), { maxPages: 8 }, "PDF_PAGE_LIMIT"],
    ["text limit", (s) => s.resolve(DOC), { maxCharsTotal: 3 }, "TEXT_LIMIT_EXCEEDED"],
    ["encrypted", (s) => s.reject(Object.assign(new Error("pw"), { name: "PasswordException" })), {}, "PDF_ENCRYPTED"],
    ["malformed", (s) => s.reject(Object.assign(new Error("x"), { name: "InvalidPDFException" })), {}, "PDF_MALFORMED"],
    ["page read failure", (s) => s.resolve({ ...DOC, getPage: async () => { throw new Error("page"); } }), {}, "EXTRACTION_FAILED"],
  ];
  it.each(cases)("%s → the task is destroyed exactly once", async (_name, settleWith, options, expected) => {
    const { extractPdfText } = shared;
    const { task, settle } = rawTask();
    settleWith(settle);
    const res = await extractPdfText(PDF_HEADER(), options, { getDocument: async () => task });
    expect(res.ok ? "ok" : res.code).toBe(expected);
    await flush();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });
});
