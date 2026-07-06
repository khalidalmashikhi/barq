import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Protected test endpoint — Engineering Sprint 2 (Auth Foundation).
//
// This exists ONLY to verify that the auth wiring (Prisma adapter,
// session helper, route handler) works end-to-end. It is not a real
// API resource per API_CONTRACTS.md's resource ownership model, carries
// no Booking/Customer/Provider business logic, and should be removed or
// replaced once real protected endpoints exist elsewhere in the
// codebase — flagged here so it isn't mistaken for a permanent pattern.
//
// Since no sign-in method is active yet (see src/lib/auth/server.ts),
// this endpoint is expected to return 401 in this sprint — that is the
// correct, verifiable outcome proving the session helper runs without
// error and correctly reports "no session" rather than throwing or
// silently succeeding.

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.user.id,
  });
}
