import "server-only";
import { resolveAssignableCategory } from "./resolve-assignable-category";

// Server-side re-validation for a client-submitted categoryId against a KNOWN
// target serviceType. Thin wrapper over the authoritative resolveAssignable
// Category() (one lookup, one rule): a category is assignable to a service of
// `serviceType` iff it resolves (exists, effectively PUBLIC, governed vertical)
// AND its own serviceTypeKey equals that serviceType.
//
// Kept for callers that already know the target serviceType. New create/update
// paths that DERIVE serviceType from the category (BR-028) call
// resolveAssignableCategory() directly instead of asserting against a literal.
export async function assertAssignableCategory(categoryId: string, serviceType: string): Promise<boolean> {
  const resolved = await resolveAssignableCategory(categoryId);
  return resolved !== null && resolved.serviceTypeKey === serviceType;
}
