import { describe, it, expect } from "vitest";
// STATIC imports: withApiV1Provider and the error classes it maps share one
// module graph here, so instanceof matches the exact classes thrown (unlike a
// dynamically-imported route test, where vitest splits the graph). provider-auth
// and @/lib/auth/errors have no server-only deps, so no mocking is needed.
import { withApiV1Provider } from "./provider-auth";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";

const req = (url = "http://x/api/v1/me/provider/profile?locale=en") => new Request(url);

describe("withApiV1Provider — provider gate mapping", () => {
  it("401 UNAUTHORIZED (no-store) when the handler throws UnauthenticatedError", async () => {
    const res = await withApiV1Provider(req(), async () => {
      throw new UnauthenticatedError();
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("403 NO_PROVIDER_PROFILE for a plain ForbiddenError (no code — the requireProvider 'no provider row' case)", async () => {
    const res = await withApiV1Provider(req(), async () => {
      throw new ForbiddenError("Provider role required");
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NO_PROVIDER_PROFILE");
  });

  it("403 PROVIDER_NOT_APPROVED from the coded ForbiddenError", async () => {
    const res = await withApiV1Provider(req(), async () => {
      throw new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED");
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PROVIDER_NOT_APPROVED");
  });

  it("403 FORBIDDEN for a deactivated provider (PROVIDER_DEACTIVATED)", async () => {
    const res = await withApiV1Provider(req(), async () => {
      throw new ForbiddenError("Provider account is deactivated", "PROVIDER_DEACTIVATED");
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("passes the resolved request locale to the handler on success", async () => {
    let seen: string | null = null;
    const res = await withApiV1Provider(new Request("http://x/api/v1/me/provider/profile?locale=ar"), async (ctx) => {
      seen = ctx.locale;
      return new Response("ok");
    });
    expect(seen).toBe("ar");
    expect(await res.text()).toBe("ok");
  });

  it("rethrows non-auth errors (→ real 500 upstream, never masked)", async () => {
    await expect(
      withApiV1Provider(req(), async () => {
        throw new Error("db exploded");
      })
    ).rejects.toThrow("db exploded");
  });
});
