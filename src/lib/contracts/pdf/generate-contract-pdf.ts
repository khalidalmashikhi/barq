import "server-only";
import type { ContractContent } from "../templates/template";
import type { ContractPdfGenerator, ContractPdfMeta } from "./pdf-generator";
import { buildSimplePdf } from "./simple-pdf-writer";

// Contract PDF Architecture — Phase E.2. Flattens a rendered
// ContractContent into plain text lines and hands them to the default
// ContractPdfGenerator implementation. Only the `.en` half of each
// bilingual field is used — see simple-pdf-writer.ts's own comment for
// why (no Arabic glyph support in a plain Type1 Helvetica PDF).

function toLines(content: ContractContent, meta: ContractPdfMeta): string[] {
  const lines: string[] = [content.title.en, "", `Contract Number: ${meta.contractNumber}`, ""];

  for (const section of content.sections) {
    lines.push(section.heading.en);
    lines.push(section.body.en);
    lines.push("");
  }

  return lines;
}

export const simpleContractPdfGenerator: ContractPdfGenerator = {
  generate(content: ContractContent, meta: ContractPdfMeta): Buffer {
    return buildSimplePdf(toLines(content, meta));
  },
};

export function generateContractPdf(content: ContractContent, meta: ContractPdfMeta): Buffer {
  return simpleContractPdfGenerator.generate(content, meta);
}
