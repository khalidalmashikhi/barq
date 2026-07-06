import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Auth route handler — Engineering Sprint 2 (Auth Foundation).
//
// Better Auth's standard Next.js App Router integration: a single
// catch-all route handler at /api/auth/[...all] that Better Auth's own
// internal routing dispatches from. No BARQ-specific business logic
// belongs in this file — it exists only to wire Better Auth's core
// handler into Next.js's routing convention.
//
// No sign-in method is active yet (see src/lib/auth/server.ts) — this
// route exists and will respond, but there is no OTP flow behind it in
// this sprint.

export const { GET, POST } = toNextJsHandler(auth);
