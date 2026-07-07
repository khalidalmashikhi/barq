// Reusable auth helper — Engineering Sprint 2 (Auth Foundation).
//
// Single public entry point for anything the rest of the application
// needs from the auth layer. Other modules should import from
// "@/lib/auth" rather than reaching into "@/lib/auth/server" or
// "@/lib/auth/session" directly — this keeps the internal file layout
// free to change without breaking every caller, consistent with
// Convention over Configuration (ARCHITECTURE_PRINCIPLES.md Principle 19).

export { auth } from "./server";
export type { Auth } from "./server";
export { getSession, requireSession } from "./session";
export {
  requireAuth,
  requireCustomer,
  requireProvider,
  requireStaff,
  requireAdmin,
} from "./rbac";
export type { AuthContext } from "./rbac";
export { withApiAuth } from "./api-guard";
export { UnauthenticatedError, ForbiddenError } from "./errors";
