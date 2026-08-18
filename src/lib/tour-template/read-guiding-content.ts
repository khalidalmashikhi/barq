import "server-only";
import { prisma } from "@/lib/db";
import { parseGuidingContent, type GuidingContent } from "./guiding-content";

// Smart Tour-Guide Template — the FAIL-CLOSED sanitized read contract (TOUR-1).
//
// The ONLY sanctioned way to read Experience.guidingContent for presentation
// (web/native). Raw Prisma Json is NEVER handed to a consumer: the stored value
// is re-validated through the same strict parseGuidingContent() used on write, so
//   - a well-formed value returns the normalized, safe shape,
//   - an absent value returns null,
//   - a MALFORMED historical value returns null (never throws, never leaks raw
//     Json, never surfaces unknown/private keys).
// This keeps a provider/public page robust against any pre-contract or corrupt
// row and guarantees only approved v1 fields ever reach a client.

// Pure: sanitize an already-loaded Json value (e.g. from a relation include).
export function sanitizeGuidingContent(value: unknown): GuidingContent | null {
  if (value === null || value === undefined) return null;
  const result = parseGuidingContent(value);
  return result.ok ? result.value : null;
}

// DB read for a single service (bounded 1:1 Experience lookup).
export async function getSanitizedGuidingContent(serviceId: string): Promise<GuidingContent | null> {
  const experience = await prisma.experience.findUnique({
    where: { serviceId },
    select: { guidingContent: true },
  });
  return sanitizeGuidingContent(experience?.guidingContent ?? null);
}

// Edit-flow read that DISTINGUISHES absent from malformed, so the provider form
// can show a safe recovery banner for corrupt historical Json (TOUR-2) instead of
// conflating it with "no tour details yet". Still never leaks raw Json.
export type GuidingContentEditRead = { kind: "none" | "ok" | "malformed"; value: GuidingContent | null };

export async function readGuidingContentForEdit(serviceId: string): Promise<GuidingContentEditRead> {
  const experience = await prisma.experience.findUnique({
    where: { serviceId },
    select: { guidingContent: true },
  });
  const raw = experience?.guidingContent ?? null;
  if (raw === null || raw === undefined) return { kind: "none", value: null };
  const parsed = parseGuidingContent(raw);
  return parsed.ok ? { kind: "ok", value: parsed.value } : { kind: "malformed", value: null };
}
