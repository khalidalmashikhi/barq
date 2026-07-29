import "server-only";

// Contract Template Engine — Phase E.2, requirement #4.
//
// BilingualText matches the exact `{ ar, en }` Json shape ADR-0005 /
// PRISMA_SCHEMA.md already establish for Service.name,
// Provider.businessName, etc. (see src/lib/i18n/extract-text.ts) —
// contract content reuses that convention rather than inventing a new
// one, even though it's freshly-generated content, not existing data.
//
// "Do NOT hardcode template text" means: the application must never
// bake one booking's final contract wording directly into a Server
// Action or route handler as a one-off string. A template — a
// reusable, parameterized definition rendered against a
// ContractRenderContext — is exactly the opposite of that. The
// boilerplate wording inside each concrete template (service-templates.ts)
// is clearly generic/placeholder language appropriate to a foundation
// phase ("This is NOT the final electronic signature implementation"),
// not represented as final legal copy.

export interface BilingualText {
  ar: string;
  en: string;
}

export interface ContractContentSection {
  heading: BilingualText;
  body: BilingualText;
}

export interface ContractContent {
  title: BilingualText;
  sections: ContractContentSection[];
}

export interface ContractRenderContext {
  bookingId: string;
  contractNumber: string;
  serviceName: BilingualText;
  providerName: BilingualText;
  priceAmount: string;
  priceCurrency: string;
  seats: number;
  generatedAt: Date;
}

export interface ContractTemplate {
  readonly key: string;
  /// Bumped whenever this template's own wording changes — captured on
  /// each generated BookingContract as `templateVersion` (requirement
  /// #5), so a later edit here never silently reinterprets what an
  /// already-generated contract's `content` was actually generated from.
  readonly version: number;
  render(context: ContractRenderContext): ContractContent;
}
