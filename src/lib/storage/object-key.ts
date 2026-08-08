import type { MediaKind, MediaOwnerType } from "./media-constants";

// Media Foundation (Gap C) — object-key construction. Pure and testable
// (no crypto/randomness baked in: the unique segment is injected), so the
// key layout is verifiable in isolation.
//
// LAYOUT: `<ownerType>/<ownerId>/<kind>/<unique>.<ext>` — e.g.
// `provider/018f.../logo/2b7c....webp`. Owner-scoped folders make a
// provider's (or service's) objects easy to reason about, list, and bulk-
// remove, and make it impossible for one owner's key to collide with
// another's. Every segment is lower-cased and the owner id is validated as
// a UUID upstream, so keys are always safe path characters only.

export function buildMediaObjectKey(input: {
  ownerType: MediaOwnerType;
  ownerId: string;
  kind: MediaKind;
  unique: string;
  ext: string;
}): string {
  const { ownerType, ownerId, kind, unique, ext } = input;
  return `${ownerType.toLowerCase()}/${ownerId}/${kind.toLowerCase()}/${unique}.${ext}`;
}
