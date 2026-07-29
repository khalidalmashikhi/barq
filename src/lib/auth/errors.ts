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

/**
 * A valid session exists, but the required role is not present — or is
 * present but doesn't meet some further, named condition (e.g. a
 * Provider that exists but isn't yet APPROVED). Maps to HTTP 403.
 *
 * `code` is optional and lets a caller distinguish *why* authorization
 * failed without needing a second error class per reason (Phase 0 —
 * Foundation Hardening, added for requireApprovedProvider()'s
 * PROVIDER_NOT_APPROVED case). Existing throws that omit it are
 * unaffected — this is additive, not a breaking change.
 */
export class ForbiddenError extends Error {
  code?: string;

  constructor(message = "Insufficient permissions", code?: string) {
    super(message);
    this.name = "ForbiddenError";
    this.code = code;
  }
}
