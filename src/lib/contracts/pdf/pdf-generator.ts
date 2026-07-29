import "server-only";
import type { ContractContent } from "../templates/template";

// Contract PDF Architecture — Phase E.2, requirement #7.
//
// A small, swappable interface — not a single hardcoded
// implementation — so a future phase can swap simple-pdf-writer.ts for
// a real branded/styled generator (a headless-browser renderer, a
// proper PDF library, a third-party rendering API) without any caller
// of generateContractPdf() changing. Mirrors this codebase's other
// factory/interface patterns (OtpProvider, ContractTemplate).

export interface ContractPdfMeta {
  contractNumber: string;
  generatedAt: Date;
  /// Reserved for future branding (logo, letterhead, color scheme) —
  /// requirement #7's "Support future branding." Unused by
  /// simple-pdf-writer.ts today; present so a future implementation
  /// doesn't need a signature change to add it.
  branding?: {
    organizationName?: string;
  };
}

export interface ContractPdfGenerator {
  generate(content: ContractContent, meta: ContractPdfMeta): Buffer;
}
