// Authorization errors — Engineering Sprint (RBAC).
//
// Single source of truth for the 401/403 distinction (task #7, #10 — no
// duplicated authorization logic). Route Handlers and Server Components
// each convert these to their own appropriate response (a JSON 401/403
// vs. a redirect) — see src/lib/auth/api-guard.ts for the Route Handler
// conversion.

/** No valid session exists. Maps to HTTP 401. */
export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** A valid session exists, but the required role is not present. Maps to HTTP 403. */
export class ForbiddenError extends Error {
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}
