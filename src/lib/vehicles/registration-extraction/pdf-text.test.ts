import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { extractPdfText } = await import("./pdf-text");
type Deps = Parameters<typeof extractPdfText>[2];

const enc = (s: string) => new TextEncoder().encode(s).buffer;
const PDF_HEADER = () => enc("%PDF-1.4\n% stub body with enough bytes for a head check\n%%EOF\n");

// A real multi-page PDF builder (fictional content). Each page is an array of text lines, or null
// for a blank (no-text) page. Correct xref so real unpdf/pdf.js parses it.
function buildPdf(pages: (string[] | null)[]): ArrayBuffer {
  const n = pages.length;
  const objs: string[] = [];
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  const kids = pages.map((_, i) => `${3 + 2 * i} 0 R`).join(" ");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  const fontObjNum = 3 + 2 * n;
  pages.forEach((lines, i) => {
    const contentNum = 4 + 2 * i;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentNum} 0 R >>`);
    let content = "";
    if (lines && lines.length > 0) {
      content = "BT /F1 12 Tf 72 740 Td ";
      lines.forEach((ln, j) => {
        const esc = ln.replace(/([()\\])/g, "\\$1");
        if (j > 0) content += "0 -18 Td ";
        content += `(${esc}) Tj `;
      });
      content += "ET";
    }
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const buf = Buffer.from(pdf, "latin1");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Loading-task DI stub. `delayMs` delays task.promise resolution (to drive timeout/cancellation).
function stub(opts: {
  numPages?: number;
  items?: Array<{ str?: string; hasEOL?: boolean }>;
  rejectWith?: Error;
  delayMs?: number;
} = {}): { deps: Deps; destroy: ReturnType<typeof vi.fn>; getDocument: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn();
  const items = opts.items ?? [{ str: "some text", hasEOL: true }];
  const doc = {
    numPages: opts.numPages ?? 1,
    getPage: async () => ({ getTextContent: async () => ({ items }), cleanup: () => {} }),
  };
  const promise = (async () => {
    if (opts.delayMs) await sleep(opts.delayMs);
    if (opts.rejectWith) throw opts.rejectWith;
    return doc;
  })();
  // Avoid an unhandled rejection warning when the timeout wins and we never await `promise`.
  promise.catch(() => {});
  const getDocument = vi.fn(async () => ({ promise, destroy }));
  return { deps: { getDocument: getDocument as unknown as NonNullable<Deps>["getDocument"] }, destroy, getDocument };
}

describe("extractPdfText — structural gates (no library call)", () => {
  it("non-PDF magic → INVALID_FILE_TYPE (library not invoked)", async () => {
    const { deps, getDocument } = stub();
    expect(await extractPdfText(enc("GIF89a...."), {}, deps)).toEqual({ ok: false, code: "INVALID_FILE_TYPE" });
    expect(getDocument).not.toHaveBeenCalled();
  });
  it("empty → PDF_MALFORMED; oversized → FILE_TOO_LARGE", async () => {
    expect(await extractPdfText(new ArrayBuffer(0))).toEqual({ ok: false, code: "PDF_MALFORMED" });
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set(new TextEncoder().encode("%PDF-"));
    expect(await extractPdfText(big.buffer)).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
  });
  it("suspicious non-whitespace payload after the final %%EOF → PDF_TRAILING_DATA (library not invoked)", async () => {
    const { deps, getDocument } = stub();
    const polyglot = enc("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\nPK\u0003\u0004ZIPPAYLOADHERE");
    expect(await extractPdfText(polyglot, {}, deps)).toEqual({ ok: false, code: "PDF_TRAILING_DATA" });
    expect(getDocument).not.toHaveBeenCalled();
  });
});

describe("extractPdfText — library outcomes (injected loading task)", () => {
  it("valid → ok with page count + reconstructed text; eval OFF / no system fonts configured", async () => {
    const { deps, getDocument } = stub({ numPages: 2, items: [{ str: "عدد الركاب: 15", hasEOL: true }] });
    const res = await extractPdfText(PDF_HEADER(), {}, deps);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.pageCount).toBe(2); expect(res.text).toContain("عدد الركاب: 15"); }
    expect(getDocument.mock.calls[0]?.[1]).toMatchObject({ isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  });
  it("too many pages → PDF_PAGE_LIMIT and the task is destroyed", async () => {
    const { deps, destroy } = stub({ numPages: 20 });
    expect(await extractPdfText(PDF_HEADER(), { maxPages: 8 }, deps)).toEqual({ ok: false, code: "PDF_PAGE_LIMIT" });
    expect(destroy).toHaveBeenCalled();
  });
  it("empty text layer → NO_TEXT_LAYER", async () => {
    const { deps } = stub({ numPages: 1, items: [] });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "NO_TEXT_LAYER" });
  });
  it("too many text items → TEXT_LIMIT_EXCEEDED (early-abort resource bound)", async () => {
    const many = Array.from({ length: 5001 }, () => ({ str: "x" }));
    const { deps } = stub({ numPages: 1, items: many });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "TEXT_LIMIT_EXCEEDED" });
  });
  it("too many characters → TEXT_LIMIT_EXCEEDED", async () => {
    const { deps } = stub({ numPages: 1, items: [{ str: "A".repeat(20_001) }] });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "TEXT_LIMIT_EXCEEDED" });
  });
  it("encrypted (PasswordException) → PDF_ENCRYPTED", async () => {
    const { deps } = stub({ rejectWith: Object.assign(new Error("pw"), { name: "PasswordException" }) });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "PDF_ENCRYPTED" });
  });
  it("malformed (InvalidPDFException) → PDF_MALFORMED; unexpected → EXTRACTION_FAILED", async () => {
    expect(await extractPdfText(PDF_HEADER(), {}, stub({ rejectWith: Object.assign(new Error("x"), { name: "InvalidPDFException" }) }).deps)).toEqual({ ok: false, code: "PDF_MALFORMED" });
    expect(await extractPdfText(PDF_HEADER(), {}, stub({ rejectWith: new Error("boom") }).deps)).toEqual({ ok: false, code: "EXTRACTION_FAILED" });
  });
});

describe("extractPdfText — real cancellation on timeout", () => {
  it("a delayed parse → PARSER_TIMEOUT, the task is destroyed, and no success is returned after timeout", async () => {
    const { deps, destroy } = stub({ numPages: 1, items: [{ str: "late", hasEOL: true }], delayMs: 120 });
    const res = await extractPdfText(PDF_HEADER(), { timeoutMs: 20 }, deps);
    expect(res).toEqual({ ok: false, code: "PARSER_TIMEOUT" });
    expect(destroy).toHaveBeenCalled();
    // Give the delayed promise time to settle; it must NOT turn into a late success or throw.
    await sleep(140);
    expect(res).toEqual({ ok: false, code: "PARSER_TIMEOUT" });
  });
});

describe("extractPdfText — REAL unpdf fixtures (fictional data)", () => {
  it("1) valid native-text PDF round-trips", async () => {
    const res = await extractPdfText(buildPdf([["Plate Number: A 12345", "Number of Passengers: 7"]]));
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.pageCount).toBe(1); expect(res.text).toContain("Number of Passengers: 7"); }
  });
  it("2) two-page registration-style layout extracts both pages", async () => {
    const res = await extractPdfText(buildPdf([["Plate Number: A 12345", "Make: Toyota"], ["Chassis Number: JTEBU29J8K5012345", "Expiry Date: 31/05/2027"]]));
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.pageCount).toBe(2); expect(res.text).toContain("A 12345"); expect(res.text).toContain("JTEBU29J8K5012345"); }
  });
  it("3) malformed/truncated PDF fails safely", async () => {
    expect((await extractPdfText(enc("%PDF-1.4\ntruncated garbage with no objects"))).ok).toBe(false);
  });
  it("4) encrypted/password-protected PDF fails closed (PDF_ENCRYPTED or a safe failure)", async () => {
    // A crafted Standard-security-handler /Encrypt dict; real pdf.js authenticates the empty
    // password against O/U, fails, and throws PasswordException → PDF_ENCRYPTED.
    const O = "0".repeat(64), U = "0".repeat(64);
    const objs = [
      `<< /Type /Catalog /Pages 2 0 R >>`,
      `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>`,
      `<< /Filter /Standard /V 1 /R 2 /O <${O}> /U <${U}> /P -44 >>`,
    ];
    let pdf = "%PDF-1.4\n"; const offs: number[] = [];
    objs.forEach((b, i) => { offs.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offs.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<0000000000000000> <0000000000000000>] >>\nstartxref\n${xref}\n%%EOF`;
    const buf = Buffer.from(pdf, "latin1");
    const res = await extractPdfText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(["PDF_ENCRYPTED", "PDF_MALFORMED", "EXTRACTION_FAILED"]).toContain(res.code);
  });
  it("5) page-limit exceeded on a real 9-page PDF → PDF_PAGE_LIMIT", async () => {
    const res = await extractPdfText(buildPdf(Array.from({ length: 9 }, () => ["x"])), { maxPages: 8 });
    expect(res).toEqual({ ok: false, code: "PDF_PAGE_LIMIT" });
  });
  it("6) real text over the character bound → TEXT_LIMIT_EXCEEDED (early-abort on real extracted content)", async () => {
    // Real extraction + a tiny overridden bound → proves the early-abort fires on genuinely
    // parsed text (robust to how pdf.js coalesces items).
    const res = await extractPdfText(buildPdf([["Plate Number: A 12345 with extra text well beyond ten chars"]]), { maxCharsTotal: 10 });
    expect(res).toEqual({ ok: false, code: "TEXT_LIMIT_EXCEEDED" });
  });
  it("7) real polyglot (valid PDF + appended payload) → PDF_TRAILING_DATA", async () => {
    const valid = Buffer.from(buildPdf([["Plate Number: A 1"]]));
    const polyglot = Buffer.concat([valid, Buffer.from("PK\u0003\u0004TRAILINGZIPPAYLOAD", "latin1")]);
    expect(await extractPdfText(polyglot.buffer.slice(polyglot.byteOffset, polyglot.byteOffset + polyglot.byteLength))).toEqual({ ok: false, code: "PDF_TRAILING_DATA" });
  });
  it("8) image-only / no-usable-text PDF → NO_TEXT_LAYER", async () => {
    expect(await extractPdfText(buildPdf([null]))).toEqual({ ok: false, code: "NO_TEXT_LAYER" });
  });
});
