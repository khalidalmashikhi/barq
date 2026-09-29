import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { extractPdfText } = await import("./pdf-text");
type Deps = Parameters<typeof extractPdfText>[2];

const enc = (s: string) => new TextEncoder().encode(s).buffer;
const PDF_HEADER = () => enc("%PDF-1.4\n% stub body enough bytes for a head check");

// A real, minimal, single-page PDF with a correct xref (Latin/ASCII text layer) so the
// REAL unpdf/pdf.js can round-trip it. All values fictional.
function buildTextPdf(text: string): ArrayBuffer {
  const escaped = text.replace(/([()\\])/g, "\\$1");
  const content = `BT /F1 18 Tf 72 700 Td (${escaped}) Tj ET`;
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (pdf += `${String(off).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const buf = Buffer.from(pdf, "latin1");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function stubDeps(over: Partial<{ numPages: number; text: string; throws: Error; hang: boolean }> = {}): { deps: Deps; getDoc: ReturnType<typeof vi.fn> } {
  const getDoc = vi.fn(async () => {
    if (over.throws) throw over.throws;
    if (over.hang) return new Promise<{ numPages: number }>(() => {}); // never resolves
    return { numPages: over.numPages ?? 1 };
  });
  const deps: Deps = {
    getDocumentProxy: getDoc as unknown as NonNullable<Deps>["getDocumentProxy"],
    extractText: async () => ({ totalPages: over.numPages ?? 1, text: over.text ?? "some text" }),
  };
  return { deps, getDoc };
}

describe("extractPdfText — content-type + size gates (no library call)", () => {
  it("rejects a non-PDF magic number as INVALID_FILE_TYPE without invoking the library", async () => {
    const { deps, getDoc } = stubDeps();
    const res = await extractPdfText(enc("GIF89a...."), {}, deps);
    expect(res).toEqual({ ok: false, code: "INVALID_FILE_TYPE" });
    expect(getDoc).not.toHaveBeenCalled();
  });
  it("empty → PDF_MALFORMED; oversized → FILE_TOO_LARGE", async () => {
    expect(await extractPdfText(new ArrayBuffer(0))).toEqual({ ok: false, code: "PDF_MALFORMED" });
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set(new TextEncoder().encode("%PDF-"));
    expect(await extractPdfText(big.buffer)).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
  });
});

describe("extractPdfText — library outcomes (injected deps, deterministic)", () => {
  it("valid → ok with page count + text, and configures eval OFF / no system fonts", async () => {
    const { deps, getDoc } = stubDeps({ numPages: 2, text: "عدد الركاب: 15" });
    const res = await extractPdfText(PDF_HEADER(), {}, deps);
    expect(res).toEqual({ ok: true, pageCount: 2, text: "عدد الركاب: 15" });
    expect(getDoc.mock.calls[0]?.[1]).toMatchObject({ isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  });
  it("too many pages → PDF_PAGE_LIMIT", async () => {
    const { deps } = stubDeps({ numPages: 20 });
    expect(await extractPdfText(PDF_HEADER(), { maxPages: 8 }, deps)).toEqual({ ok: false, code: "PDF_PAGE_LIMIT" });
  });
  it("empty text layer → NO_TEXT_LAYER", async () => {
    const { deps } = stubDeps({ numPages: 1, text: "   " });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "NO_TEXT_LAYER" });
  });
  it("encrypted (PasswordException) → PDF_ENCRYPTED", async () => {
    const { deps } = stubDeps({ throws: Object.assign(new Error("pw"), { name: "PasswordException" }) });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "PDF_ENCRYPTED" });
  });
  it("malformed (InvalidPDFException) → PDF_MALFORMED", async () => {
    const { deps } = stubDeps({ throws: Object.assign(new Error("bad"), { name: "InvalidPDFException" }) });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "PDF_MALFORMED" });
  });
  it("unexpected exception → EXTRACTION_FAILED (never a raw exception)", async () => {
    const { deps } = stubDeps({ throws: new Error("boom") });
    expect(await extractPdfText(PDF_HEADER(), {}, deps)).toEqual({ ok: false, code: "EXTRACTION_FAILED" });
  });
  it("a hung parse → PARSER_TIMEOUT", async () => {
    const { deps } = stubDeps({ hang: true });
    expect(await extractPdfText(PDF_HEADER(), { timeoutMs: 20 }, deps)).toEqual({ ok: false, code: "PARSER_TIMEOUT" });
  });
});

describe("extractPdfText — REAL unpdf integration", () => {
  it("round-trips a generated minimal PDF: extracts text + page count", async () => {
    const res = await extractPdfText(buildTextPdf("Passengers 15"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pageCount).toBe(1);
      expect(res.text).toContain("Passengers 15");
    }
  });
  it("real garbage-after-header PDF fails safely (never throws a raw exception)", async () => {
    const res = await extractPdfText(enc("%PDF-1.4\nthis is not a real pdf body at all"));
    expect(res.ok).toBe(false);
  });
});
