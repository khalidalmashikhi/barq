import { describe, it, expect, vi } from "vitest";

// Phase E.2 — regression tests for buildSimplePdf: confirms the output
// is a genuinely well-formed PDF (correct header/footer, an xref
// section with the right object count, page count matches input
// pagination), not just "returns some Buffer."

vi.mock("server-only", () => ({}));

const { buildSimplePdf } = await import("./simple-pdf-writer");

describe("buildSimplePdf", () => {
  it("produces a buffer starting with the PDF header and ending with %%EOF", () => {
    const pdf = buildSimplePdf(["Hello, contract."]);
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdf.subarray(-5).toString("latin1")).toBe("%%EOF");
  });

  it("produces exactly one page for a short line count", () => {
    const pdf = buildSimplePdf(["line 1", "line 2"]);
    const text = pdf.toString("latin1");
    expect(text).toMatch(/\/Count 1/);
  });

  it("paginates across multiple pages once line count exceeds one page", () => {
    const manyLines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
    const pdf = buildSimplePdf(manyLines);
    const text = pdf.toString("latin1");
    const match = text.match(/\/Count (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(1);
  });

  it("escapes parentheses and backslashes so the content stream stays valid", () => {
    const pdf = buildSimplePdf(["Price: (100) OMR", "Path: C:\\temp"]);
    const text = pdf.toString("latin1");
    expect(text).toContain("Price: \\(100\\) OMR");
    expect(text).toContain("Path: C:\\\\temp");
  });

  it("produces a non-empty page even when given zero lines", () => {
    const pdf = buildSimplePdf([]);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.toString("latin1")).toMatch(/\/Count 1/);
  });

  it("has an xref offset table whose object count matches the actual object count", () => {
    const pdf = buildSimplePdf(["a single line"]);
    const text = pdf.toString("latin1");
    // 1 page => 3 fixed objects (Catalog, Pages, Font) + 2 per page (Content, Page) = 5
    expect(text).toMatch(/xref\n0 6\n/);
  });
});
