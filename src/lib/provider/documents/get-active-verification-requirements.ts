import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { VerificationRequirementAudience } from "@/lib/provider-document-types";

// ADR-0017 — server-only reader for the configured provider verification policy.
//
// Returns EVERY ProviderVerificationRequirement row (active and inactive),
// ordered by sortOrder, so callers can:
//   - distinguish an UNSEEDED table ([] → fail closed to code defaults) from a
//     DB READ FAILURE (null → fail closed to code defaults) from a real admin
//     policy (non-empty → authoritative), and
//   - filter `active` themselves for the specific decision they make (required
//     keys for BR-029 vs. the full provider checklist).
//
// FAIL CLOSED: any read failure is swallowed and reported as `null`, NEVER as an
// empty array — the pure resolvers (policy.ts) then fall back to the non-empty
// code-default required set, so a database problem can never silently reduce the
// required set to nothing. `name`/`description` are passed through as raw JSON
// (bilingual `{ar,en}` maps) for `extractLocalizedText` to render at the edge.

export type VerificationRequirementRecord = {
  key: string;
  name: Prisma.JsonValue;
  description: Prisma.JsonValue | null;
  appliesTo: VerificationRequirementAudience;
  required: boolean;
  active: boolean;
  sortOrder: number;
};

export async function getActiveVerificationRequirements(): Promise<VerificationRequirementRecord[] | null> {
  try {
    return await prisma.providerVerificationRequirement.findMany({
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
      select: {
        key: true,
        name: true,
        description: true,
        appliesTo: true,
        required: true,
        active: true,
        sortOrder: true,
      },
    });
  } catch {
    // Fail closed: signal "could not read the policy" as null (not []), so the
    // caller falls back to the code-default required set rather than to "require
    // nothing". No error detail is surfaced (could carry connection info).
    return null;
  }
}
