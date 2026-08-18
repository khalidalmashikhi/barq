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
