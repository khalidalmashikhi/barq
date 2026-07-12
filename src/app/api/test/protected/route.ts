import { NextResponse } from "next/server";
import { requireAuth, withApiAuth } from "@/lib/auth";

// Protected test endpoint — Engineering Sprint 2 (Auth Foundation),
// updated by the RBAC sprint to demonstrate the withApiAuth() +
// requireAuth() pattern every real protected API route should follow.
//
// Still a verification tool, not a real API resource per
// API_CONTRACTS.md's resource ownership model — same scope note as
// when this file was first created.
//
// PRODUCTION-DISABLED (stabilization task): same `NODE_ENV ===
// "production"` gate already used by src/lib/auth/server.ts's dev-only
// OTP logger. Returns a generic 404 before any auth logic runs, so
// this verification tool is never reachable, and its existence/shape
// is never revealed, outside development/test environments.

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return withApiAuth(async () => {
    const { barqUser } = await requireAuth();

    return NextResponse.json({
      authenticated: true,
      barqUserId: barqUser.id,
    });
  });
}
