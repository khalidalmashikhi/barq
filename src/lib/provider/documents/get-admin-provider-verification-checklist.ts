import "server-only";
import type { ProviderType } from "@prisma/client";
import { resolveVerificationChecklist } from "@/lib/provider-document-types";
import { getActiveVerificationRequirements } from "./get-active-verification-requirements";
import { listProviderDocumentsForAdmin, type AdminProviderDocumentListItem } from "./list-provider-documents-for-admin";

// Gate 1B — the admin verification workspace, rendered from the FULL resolved
// requirement checklist (not only uploaded rows), so a MISSING required document
// is visible as its own row rather than hidden inside an approval blocker. Reuses
// the SAME fail-closed policy resolver as the provider side and the approval gate
// (getActiveVerificationRequirements + resolveVerificationChecklist), so admin and
// provider always see the same applicable requirements. Requirement-driven → works
// unchanged for COMPANY (Commercial Registration) without hardcoding IDENTITY_PROOF.
//
// listProviderDocumentsForAdmin() is requireAdmin()-gated and NEVER exposes the
// objectKey (only the opaque versionToken). Any uploaded document whose type is no
// longer an active requirement is still surfaced (as an orphan row) so the admin
// never loses sight of a submitted document.

export type AdminVerificationChecklistItem = {
  type: string;
  required: boolean;
  name: unknown; // bilingual {ar,en} map — render via extractLocalizedText
  description: unknown;
  document: AdminProviderDocumentListItem | null;
};

export type AdminProviderVerification = {
  items: AdminVerificationChecklistItem[];
  requiredTotal: number;
  requiredApproved: number;
};

export async function getAdminProviderVerificationChecklist(
  providerId: string,
  providerType: ProviderType
): Promise<AdminProviderVerification> {
  const policyRows = await getActiveVerificationRequirements();
  const checklist = resolveVerificationChecklist(policyRows, { providerType });
  const documents = await listProviderDocumentsForAdmin(providerId);
  const byType = new Map(documents.map((d) => [d.type, d]));

  const checklistItems: AdminVerificationChecklistItem[] = checklist.map((req) => ({
    type: req.key,
    required: req.required,
    name: req.name,
    description: req.description,
    document: byType.get(req.key) ?? null,
  }));

  // Uploaded documents whose type is no longer an active requirement — surface
  // them so the admin never loses a submitted document (rare edge case).
  const checklistTypes = new Set(checklist.map((r) => r.key));
  const orphanItems: AdminVerificationChecklistItem[] = documents
    .filter((d) => !checklistTypes.has(d.type))
    .map((d) => ({ type: d.type, required: false, name: null, description: null, document: d }));

  const requiredItems = checklist.filter((req) => req.required);
  const requiredApproved = requiredItems.filter((req) => byType.get(req.key)?.status === "APPROVED").length;

  return {
    items: [...checklistItems, ...orphanItems],
    requiredTotal: requiredItems.length,
    requiredApproved,
  };
}
