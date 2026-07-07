import { NextResponse } from "next/server";
import { requireAuth, withApiAuth } from "@/lib/auth";

// Protected test endpoint — Engineering Sprint 2 (Auth Foundation),
// updated by the RBAC sprint to demonstrate the withApiAuth() +
// requireAuth() pattern every real protected API route should follow.
//
// Still a verification tool, not a real API resource per
// API_CONTRACTS.md's resource ownership model — same scope note as
// when this file was first created.

export async function GET() {
  return withApiAuth(async () => {
    const { barqUser } = await requireAuth();

    return NextResponse.json({
      authenticated: true,
      barqUserId: barqUser.id,
    });
  });
}
