// TEST SUPPORT ONLY — synthetic, fictional documents for the vehicle-document test suites. No real
// registration document, person, plate or VIN appears here or anywhere in the repository. Imported
// only by *.test.ts files.

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A real, parseable multi-page PDF. Each page is an array of text lines, or null for a blank page. */
export function buildSyntheticPdf(pages: (string[] | null)[]): ArrayBuffer {
  const n = pages.length;
  const objs: string[] = [];
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${n} >>`);
  const fontObjNum = 3 + 2 * n;
  pages.forEach((lines, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${4 + 2 * i} 0 R >>`);
    let content = "";
    if (lines && lines.length > 0) {
      content = "BT /F1 12 Tf 72 740 Td ";
      lines.forEach((ln, j) => {
        if (j > 0) content += "0 -18 Td ";
        content += `(${ln.replace(/([()\\])/g, "\\$1")}) Tj `;
      });
      content += "ET";
    }
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  return toArrayBuffer(assemble(objs, `/Root 1 0 R`));
}

/**
 * A PDF with ONE incremental update appended — the structure a digitally SIGNED or "saved in
 * place" PDF has: the original file (ending in its own %%EOF), then a second body, a second xref
 * section, a trailer pointing back with /Prev, and a second %%EOF that ends the file. Two %%EOF
 * markers; nothing after the last one.
 */
export function buildIncrementallyUpdatedPdf(pages: (string[] | null)[]): ArrayBuffer {
  const base = Buffer.from(buildSyntheticPdf(pages));
  const text = base.toString("latin1");
  const prevXref = Number(/startxref\n(\d+)\n%%EOF$/.exec(text)![1]);
  const size = Number(/\/Size (\d+)/.exec(text)![1]);
  let update = "\n";
  const objOffset = base.length + Buffer.byteLength(update, "latin1");
  update += `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`; // the catalog, re-written unchanged
  const xrefOffset = base.length + Buffer.byteLength(update, "latin1");
  update += `xref\n0 2\n0000000000 65535 f \n${String(objOffset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${size} /Root 1 0 R /Prev ${prevXref} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return toArrayBuffer(Buffer.concat([base, Buffer.from(update, "latin1")]));
}

/** A PDF carrying a Standard-security /Encrypt dictionary (password-protected). */
export function buildEncryptedPdf(): ArrayBuffer {
  const zeros = "0".repeat(64);
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>`,
    `<< /Filter /Standard /V 1 /R 2 /O <${zeros}> /U <${zeros}> /P -44 >>`,
  ];
  return toArrayBuffer(assemble(objs, `/Root 1 0 R /Encrypt 4 0 R /ID [<0000000000000000> <0000000000000000>]`));
}

function assemble(objs: string[], trailerEntries: string): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objs.length + 1} ${trailerEntries} >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** The leading bytes of an ISO-BMFF file with the given major brand (e.g. "heic", "mif1", "avif"). */
export function isoBmffHeader(brand: string): ArrayBuffer {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(24, 0);
  buf.write("ftyp", 4, "latin1");
  buf.write(brand.padEnd(4, " ").slice(0, 4), 8, "latin1");
  return toArrayBuffer(buf);
}

/** Fictional registration lines the native-text parser recognizes. */
export const SYNTHETIC_REGISTRATION_LINES = [
  "TEST DOCUMENT - NOT A REAL VEHICLE REGISTRATION",
  "Plate Number: T 99001",
  "Vehicle Make: Toyota",
  "Model: Testcruiser",
  "Model Year: 2020",
  "Color: White",
  "Number of Passengers: 7",
  "Chassis Number: TESTV1N0000000001",
];
