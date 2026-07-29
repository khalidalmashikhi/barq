import "server-only";

// Contract PDF Architecture — Phase E.2, requirement #7's default
// implementation. Hand-rolled, minimal, valid PDF byte construction —
// no new npm dependency, consistent with this codebase's established
// minimal-dependency preference (e.g. Twilio via plain fetch in
// src/lib/otp/providers/twilio-provider.ts, Phase D.4). "Do NOT focus
// on visual styling" is taken literally here: one font (Helvetica),
// one size, plain black text, no layout beyond simple line wrapping —
// "clean professional," not decorated.
//
// KNOWN, DELIBERATE LIMITATION: this writer only supports Latin
// (English) text. PDF's standard Type1 fonts (Helvetica included) use
// WinAnsi-family encodings with no Arabic glyphs, and correct Arabic
// PDF rendering requires an embedded Unicode font plus right-to-left
// text shaping — real engineering effort far beyond "do not focus on
// visual styling." Rather than silently emit garbled bilingual output,
// generate-contract-pdf.ts renders only each section's `.en` text
// through this writer; a future, real PDF implementation (swapped in
// via the ContractPdfGenerator interface, not a change to any caller)
// is the correct place to add proper Arabic support.

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LINE_HEIGHT = 16;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildContentStream(pageLines: string[]): string {
  const startY = PAGE_HEIGHT - MARGIN;
  const lines = [`BT`, `/F1 ${FONT_SIZE} Tf`, `${MARGIN} ${startY} Td`, `${LINE_HEIGHT} TL`];

  pageLines.forEach((line, index) => {
    const escaped = escapePdfText(line);
    if (index > 0) lines.push("T*");
    lines.push(`(${escaped}) Tj`);
  });

  lines.push("ET");
  return lines.join("\n");
}

// Builds a valid, minimal, multi-page PDF from plain text lines (one
// line per array entry — this function does not wrap long lines,
// callers are expected to pass already-reasonably-sized lines).
export function buildSimplePdf(lines: string[]): Buffer {
  const pages = chunk(lines.length > 0 ? lines : [""], LINES_PER_PAGE);
  const fontObjNum = 3;

  const contentObjNums: number[] = [];
  const pageObjNums: number[] = [];
  let nextObjNum = 4;
  for (let i = 0; i < pages.length; i++) {
    contentObjNums.push(nextObjNum++);
    pageObjNums.push(nextObjNum++);
  }

  const totalObjects = 3 + pages.length * 2;
  const objBodies: string[] = new Array(totalObjects);

  objBodies[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objBodies[1] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objBodies[2] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  for (let i = 0; i < pages.length; i++) {
    const contentBody = buildContentStream(pages[i] ?? []);
    const contentObjNum = contentObjNums[i]!;
    const pageObjNum = pageObjNums[i]!;

    objBodies[contentObjNum - 1] =
      `<< /Length ${Buffer.byteLength(contentBody, "utf-8")} >>\nstream\n${contentBody}\nendstream`;
    objBodies[pageObjNum - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>`;
  }

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = [];
  let currentOffset = Buffer.byteLength(header, "utf-8");

  for (const objBody of objBodies) {
    offsets.push(currentOffset);
    const objStr = `${offsets.length} 0 obj\n${objBody}\nendobj\n`;
    body += objStr;
    currentOffset += Buffer.byteLength(objStr, "utf-8");
  }

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "utf-8");
}
