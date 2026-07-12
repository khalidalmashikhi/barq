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
//
// PRODUCTION-DISABLED (stabilization task): same convention as
// /api/test/protected — see that file's comment for the full
// reasoning. Gated before any auth/role logic runs.

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return withApiAuth(async () => {
    const { admin } = await requireAdmin();

    return NextResponse.json({
      authenticated: true,
      role: "admin",
      adminId: admin.id,
    });
  });
}
