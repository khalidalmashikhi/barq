import "server-only";
import { createHash } from "node:crypto";

// Opaque document version token — Gate 2 (RC3 concurrency). The immutable
// objectKey is the version identifier, but it must NEVER be exposed to the
// browser. This derives a stable, non-reversible fingerprint of the current
// objectKey that CAN be handed to a client: it changes whenever the document is
// replaced (new key), and it reveals nothing about the key (SHA-256 pre-image
// resistant; the key is itself a random-uuid path).
//
// Flow: a list/read surface returns documentVersionToken(objectKey) per row;
// a later mutating request (provider replace/delete, admin approve/reject)
// passes the token back; the domain re-reads the current objectKey, recomputes
// the token, and proceeds ONLY if it matches (else STALE_DOCUMENT). The atomic
// conditional update is still additionally bound to the objectKey, so a race
// between the check and the write is also caught.

export function documentVersionToken(objectKey: string): string {
  return createHash("sha256").update(objectKey).digest("hex");
}
