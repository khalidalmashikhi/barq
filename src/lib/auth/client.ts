import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";

// Better Auth browser client — Engineering Sprint 3 (Phone OTP UI).
//
// Deliberately a SEPARATE file from src/lib/auth/index.ts / server.ts.
// server.ts imports the Prisma client and must never be bundled into
// browser code — client components import this file directly
// ("@/lib/auth/client"), never the server barrel.
//
// The phoneNumberVerified schema blocker referenced in earlier versions
// of this comment was resolved in the "Phone OTP Schema Support" sprint
// (DEVELOPMENT_LOG.md Entry 043) — the field exists and the server-side
// plugin is configured (src/lib/auth/server.ts). The remaining open
// question is whether Better Auth's User auto-creation on first
// verification works correctly given BARQ's User model has no email/
// name/image fields — see DEVELOPMENT_LOG.md Entries 043-044 for the
// full, still-unresolved detail. That question affects verify() at
// runtime, not this file's correctness.

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  plugins: [phoneNumberClient()],
});
