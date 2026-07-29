import "server-only";
import type { ContractTemplate } from "./template";
import { standardServiceTemplate, premiumServiceTemplate, corporateTemplate } from "./service-templates";

// Contract Template Engine — Phase E.2. The ONLY place that selects a
// template by key — mirrors src/lib/otp/get-otp-provider.ts's factory
// pattern from Phase D.4 exactly (switching/adding a template is a
// config-only change here, no other file branches on template key).
//
// "GOVERNMENT" is requirement #4's explicitly-named future template
// ("Future Government") — reserved as a recognized key so a future
// phase adding it is a one-line addition to this switch, but throwing
// clearly today rather than silently falling back to a wrong template,
// since implementing it is explicitly out of this phase's scope.

export type ContractTemplateKey = "STANDARD_SERVICE" | "PREMIUM_SERVICE" | "CORPORATE" | "GOVERNMENT";

export function getContractTemplate(key: ContractTemplateKey): ContractTemplate {
  switch (key) {
    case "STANDARD_SERVICE":
      return standardServiceTemplate;
    case "PREMIUM_SERVICE":
      return premiumServiceTemplate;
    case "CORPORATE":
      return corporateTemplate;
    case "GOVERNMENT":
      throw new Error(
        "getContractTemplate: GOVERNMENT is a reserved future template key (requirement #4's \"Future Government\") — not implemented yet."
      );
    default:
      throw new Error(`getContractTemplate: unknown template key "${key}"`);
  }
}
