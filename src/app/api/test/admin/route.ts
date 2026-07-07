import { NextResponse } from "next/server";
import { requireAdmin, withApiAuth } from "@/lib/auth";

// Role-scoped test endpoint — Engineering Sprint (RBAC).
//
// Exists specifically to exercise the 403 path — /api/test/protected
// only ever demonstrates 401 (unauthenticated) vs. 200 (any
// authenticated user). This endpoint is the one place in this sprint
// that actually proves requireAdmin() correctly rejects an
// authenticated-but-non-Admin user with 403, not just an
// unauthenticated one with 401. Same verification-tool scope as
// /api/test/protected — not a real BARQ Admin API resource.

export async function GET() {
  return withApiAuth(async () => {
    const { admin } = await requireAdmin();

    return NextResponse.json({
      authenticated: true,
      role: "admin",
      adminId: admin.id,
    });
  });
}
