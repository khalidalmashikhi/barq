import { NextResponse } from "next/server";
import { verifyContractToken } from "@/lib/contracts/execution";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Public Verification Endpoint — Phase E.3, requirement #6. "No
// external verification service yet" — a 100% internal database
// lookup by an opaque token, requiring no BARQ account/session at all
// (this is the whole point: a third party — e.g. a government office
// checking a printed contract's QR code — has no BARQ login).
//
// SECURITY: returns only {valid, contractNumber, status, executedAt} —
// never the contract's `content`/terms, never signer identities, never
// any other business-sensitive field. An invalid/unknown token gets
// exactly {valid:false} — no distinguishing detail about WHY it's
// invalid (nonexistent vs. malformed), so this endpoint cannot be used
// to probe for valid token shapes.

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withRequestTracing("contracts.verify", async () => {
    const { token } = await params;

    if (!token || token.length > 256) {
      return NextResponse.json({ valid: false });
    }

    const result = await verifyContractToken(token);
    return NextResponse.json(result);
  });
}
