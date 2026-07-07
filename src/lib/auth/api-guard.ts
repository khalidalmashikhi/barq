import "server-only";
import { NextResponse } from "next/server";
import { UnauthenticatedError, ForbiddenError } from "./errors";

// API route guard — Engineering Sprint (RBAC).
//
// The single place that converts a thrown auth error into an HTTP
// response (task #7: proper status codes; task #10: no duplicated
// authorization logic). A Route Handler wraps its logic in this once,
// rather than every route writing its own try/catch/status mapping.
//
// Usage:
//   export async function GET() {
//     return withApiAuth(async () => {
//       const { barqUser } = await requireAuth();
//       return NextResponse.json({ userId: barqUser.id });
//     });
//   }

export async function withApiAuth<T>(
  handler: () => Promise<T>
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    // Not an authorization error — rethrow so it surfaces as a real 500,
    // never silently swallowed or misreported as an auth failure.
    throw error;
  }
}
