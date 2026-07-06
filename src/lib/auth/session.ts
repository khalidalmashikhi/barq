import { headers } from "next/headers";
import { auth } from "./server";

// Session access helper — Engineering Sprint 2 (Auth Foundation).
//
// Wraps Better Auth's session lookup so the rest of the application never
// calls `auth.api.getSession` directly — one place owns this pattern,
// consistent with this project's Composition over Duplication principle
// (ARCHITECTURE_PRINCIPLES.md Principle 18).
//
// This helper does not distinguish Customer/Provider/Staff/Admin roles —
// that is IDENTITY_AND_ACCESS.md's authorization concern, not this
// document's. This helper answers only "is there a valid session, and
// who does Better Auth say the User is" — nothing more.

/**
 * Returns the current session, or null if the request is unauthenticated.
 * Never throws for the "no session" case — callers decide how to handle
 * an absent session (redirect, 401 response, etc.).
 */
export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Returns the current session, throwing if none exists. Use only where
 * the caller genuinely cannot proceed without an authenticated session
 * (e.g. a protected Route Handler) — prefer `getSession` where an absent
 * session is a normal, handleable case rather than an error.
 */
export async function requireSession() {
  const session = await getSession();

  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }

  return session;
}
