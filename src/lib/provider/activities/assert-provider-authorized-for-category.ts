import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";

// Gate B5 — the SINGLE server-side authorization primitive for the
// service ↔ category relationship. A provider may create, re-categorize, or
// publish a service on a category ONLY when they hold an authorized
// ProviderCategory link for it. Every authorized provenance counts equally:
//
//   SELF   — the provider's own self-selected primary activity
//   ADMIN  — an activity an ACTIVE admin granted them (Gate B4)
//   LEGACY — a pre-Gate-B link, preserved and authorized
//
// This is DELIBERATELY SEPARATE from resolveAssignableCategory (category
// *validity* / effective visibility). Those answer different questions and MUST
// compose, neither replacing the other:
//
//   resolveAssignableCategory  → "is this a real, effectively-PUBLIC, governed
//                                 category anyone could file a service under?"
//   isProviderAuthorizedForCategory → "is THIS provider allowed to sell in it?"
//
// A category can be perfectly assignable yet unauthorized for a given provider
// (they were never granted it), and — for historical services — a category can
// be authorized-at-the-time yet no longer publicly assignable. Keeping the two
// checks apart is what lets the call sites return precise, honest errors
// (INVALID_CATEGORY vs ACTIVITY_NOT_AUTHORIZED) and preserve historical
// compatibility.
//
// Existence is checked on the ProviderCategory composite primary key
// (providerId, categoryId) — a single index-only lookup, no provenance filter,
// because authorization does not depend on WHICH authorized source granted it.

export async function isProviderAuthorizedForCategory(providerId: string, categoryId: string): Promise<boolean> {
  // A syntactically invalid id can never match a stored @db.Uuid link — treat it
  // as unauthorized rather than letting it reach the query (which would throw).
  if (!isValidUuid(providerId) || !isValidUuid(categoryId)) return false;

  const link = await prisma.providerCategory.findUnique({
    where: { providerId_categoryId: { providerId, categoryId } },
    select: { providerId: true },
  });

  return link !== null;
}
