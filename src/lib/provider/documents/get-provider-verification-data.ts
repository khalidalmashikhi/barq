import "server-only";
import type { ProviderType, ProviderDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { isDocumentStorageConfigured } from "@/lib/storage/storage";
import { resolveVerificationChecklist, resolveSubmitBlockers, type SubmitBlocker } from "@/lib/provider-document-types";
import { getActiveVerificationRequirements } from "./get-active-verification-requirements";
import { documentVersionToken } from "./document-version-token";
import { isVerificationEditableStatus } from "./verification-lifecycle";

// Single provider-side read backing the /provider/verification page AND the
// dashboard readiness card — so the required/optional checklist is derived once,
// server-side, from the same fail-closed policy resolver the approval gate uses
// (no duplicate logic in React). Own documents only (requireProvider). Never
// exposes objectKey — each uploaded document carries the opaque versionToken for
// replace/delete binding.
//
// ADR-0017: the checklist rows come from the admin-configured policy
// (getActiveVerificationRequirements) via resolveVerificationChecklist, which
// falls back to the code defaults when the policy is unreadable/unseeded — so the
// provider always sees at least the default checklist, never an empty one on a DB
// hiccup. `type` is a plain string (an admin-created key need not be in the code
// registry); `name`/`description` are raw bilingual JSON maps rendered at the
// edge via extractLocalizedText.

export type VerificationChecklistItem = {
  type: string;
  required: boolean;
  name: unknown; // bilingual {ar,en} locale map — render via extractLocalizedText
  description: unknown; // bilingual locale map or null
  document: {
    id: string;
    status: ProviderDocumentStatus;
    originalFilename: string;
    sizeBytes: number;
    rejectionReason: string | null;
    versionToken: string;
  } | null;
};

export type ProviderVerificationData = {
  providerType: ProviderType;
  providerStatus: string;
  storageAvailable: boolean;
  items: VerificationChecklistItem[]; // ordered by policy sortOrder (required first by default)
  requiredTotal: number;
  requiredApproved: number;
  // Gate 1A/1B submission lifecycle. `editable` gates document mutation + the
  // submit control to DRAFT or CHANGES_REQUESTED. `canSubmit` is TRUE only when
  // editable AND every required document is present (not admin-REJECTED) —
  // presence-only readiness.
  editable: boolean;
  canSubmit: boolean;
  submitBlockers: SubmitBlocker[];
  // Gate 1B — the admin's mandatory reason when status is CHANGES_REQUESTED
  // (reused rejectionReason field); null otherwise. Shown so the provider knows
  // what to fix before re-submitting.
  changesRequestedReason: string | null;
};

export async function getProviderVerificationData(): Promise<ProviderVerificationData> {
  const { provider } = await requireProvider();

  const rows = await prisma.providerDocument.findMany({ where: { providerId: provider.id } });
  const byType = new Map(rows.map((r) => [r.type, r]));

  // Fail-closed configured checklist (required + optional) applicable to this
  // provider type. null (DB error) / [] (unseeded) → code defaults.
  const policyRows = await getActiveVerificationRequirements();
  const checklist = resolveVerificationChecklist(policyRows, { providerType: provider.providerType });

  const items: VerificationChecklistItem[] = checklist.map((req) => {
    const r = byType.get(req.key);
    return {
      type: req.key,
      required: req.required,
      name: req.name,
      description: req.description,
      document: r
        ? {
            id: r.id,
            status: r.status,
            originalFilename: r.originalFilename,
            sizeBytes: r.sizeBytes,
            rejectionReason: r.rejectionReason,
            versionToken: documentVersionToken(r.objectKey),
          }
        : null,
    };
  });

  const requiredItems = checklist.filter((req) => req.required);
  const requiredApproved = requiredItems.filter((req) => byType.get(req.key)?.status === "APPROVED").length;

  // Gate 1A submission readiness — presence-only (a PENDING/APPROVED doc passes;
  // MISSING or admin-REJECTED blocks). Same resolver the authoritative submit
  // path uses (assertReadyToSubmit), so the button state matches the server gate.
  const submitBlockers = resolveSubmitBlockers(
    requiredItems.map((req) => req.key),
    rows.map((r) => ({ type: r.type, status: r.status }))
  );
  const editable = isVerificationEditableStatus(provider.status);

  return {
    providerType: provider.providerType,
    providerStatus: provider.status,
    storageAvailable: isDocumentStorageConfigured(),
    items,
    requiredTotal: requiredItems.length,
    requiredApproved,
    editable,
    canSubmit: editable && submitBlockers.length === 0,
    submitBlockers,
    changesRequestedReason: provider.status === "CHANGES_REQUESTED" ? provider.rejectionReason : null,
  };
}
