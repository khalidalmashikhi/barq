import "server-only";
import { createHash } from "node:crypto";
import type { ReviewTabBinding } from "./review-field-state";

// 2026-10-12 — the opaque binding for the review form's TAB MEMORY (unsaved non-sensitive values kept
// in the tab's sessionStorage across a language switch). Computed on the server from the signed-in
// session and the stored reading; only the two hashes reach the browser — no raw id, no document
// value. A remembered record is restored only when BOTH still match:
//   identity — the signed-in provider (and their user): another provider / account in the same tab
//              never sees it;
//   source   — the registration set (every page's document id) + the reading row (id, set hash,
//              semantic version, last success) + the reading's extracted values: a replaced document,
//              a re-read, a completion merge or any new result changes it.
// Saving a draft does NOT change it (confirmation values are not an input), so onboarding choices the
// draft does not store survive a "save progress".

const sha = (parts: readonly string[]) => createHash("sha256").update(parts.join("\u0001")).digest("hex").slice(0, 32);

export function reviewTabBinding(input: {
  providerId: string;
  userId: string;
  documentIds: readonly string[];
  extraction: { id: string; documentSha256: string; parserVersion: string; lastSucceededAt: Date | null } | null;
  extractedValues: ReadonlyArray<{ key: string; extractedValue: string | number | null; alternatives: ReadonlyArray<string | number> }>;
}): ReviewTabBinding {
  const identity = sha(["barq-review-tab-identity-v1", input.providerId, input.userId]);
  const source = sha([
    "barq-review-tab-source-v1",
    ...input.documentIds,
    input.extraction?.id ?? "-",
    input.extraction?.documentSha256 ?? "-",
    input.extraction?.parserVersion ?? "-",
    input.extraction?.lastSucceededAt?.toISOString() ?? "-",
    JSON.stringify(input.extractedValues.map((f) => [f.key, f.extractedValue, f.alternatives])),
  ]);
  return { identity, source };
}
