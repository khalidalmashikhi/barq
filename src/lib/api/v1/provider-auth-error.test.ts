import { describe, it, expect } from "vitest";
// STATIC imports, NO mocks: providerAuthErrorResponse and the error classes it maps
// share one module graph here, so instanceof matches the exact classes constructed
// (the same pattern provider-auth.test.ts relies on). Neither module has server-only
// deps, so nothing needs mocking.
import { providerAuthErrorResponse } from "./provider-auth-error";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";

async function read(res: Response) {
  return { status: res.status, code: (await res.json()).error.code, store: res.headers.get("cache-control") };
}

describe("providerAuthErrorResponse — shared provider auth-error mapping", () => {
  it("401 UNAUTHORIZED (no-store) for UnauthenticatedError", async () => {
    const res = providerAuthErrorResponse(new UnauthenticatedError(), "en")!;
    expect(await read(res)).toEqual({ status: 401, code: "UNAUTHORIZED", store: "no-store" });
  });

  it("403 NO_PROVIDER_PROFILE for a plain ForbiddenError (no code — no provider row)", async () => {
    const res = providerAuthErrorResponse(new ForbiddenError("Provider role required"), "en")!;
    expect(await read(res)).toMatchObject({ status: 403, code: "NO_PROVIDER_PROFILE" });
  });

  it("403 PROVIDER_NOT_APPROVED for the coded ForbiddenError", async () => {
    const res = providerAuthErrorResponse(new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED"), "en")!;
    expect(await read(res)).toMatchObject({ status: 403, code: "PROVIDER_NOT_APPROVED" });
  });

  it("403 FORBIDDEN for a deactivated provider (PROVIDER_DEACTIVATED)", async () => {
    const res = providerAuthErrorResponse(new ForbiddenError("Provider account is deactivated", "PROVIDER_DEACTIVATED"), "en")!;
    expect(await read(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("403 FORBIDDEN for an inactive user account (USER_INACTIVE)", async () => {
    const res = providerAuthErrorResponse(new ForbiddenError("User account is inactive", "USER_INACTIVE"), "en")!;
    expect(await read(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("returns null for a non-auth error (caller rethrows → real 500, never masked)", () => {
    expect(providerAuthErrorResponse(new Error("db exploded"), "en")).toBeNull();
    expect(providerAuthErrorResponse("not even an error", "en")).toBeNull();
  });
});
