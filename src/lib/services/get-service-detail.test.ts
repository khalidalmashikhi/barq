import { describe, it, expect, vi, afterEach } from "vitest";

// Production Blocker fix — regression tests proving getServiceById() now
// scopes on Provider.status/visible, mirroring get-services.ts's own
// "NO PROVIDER-VISIBILITY GATE, FOUND AND FIXED" precedent. Before this
// fix, a service published while its provider was APPROVED remained
// fully reachable (and bookable, via services/[id]/book) even after that
// provider was later archived (DEACTIVATED) — a real gap this test
// guards against regressing.

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
}));

const { getServiceById } = await import("./get-service-detail");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  findFirstMock.mockReset();
});

describe("getServiceById", () => {
  it("queries with the provider APPROVED+visible gate, not just Service.status", async () => {
    findFirstMock.mockResolvedValue(null);

    await getServiceById(SERVICE_ID);

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SERVICE_ID, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
      })
    );
  });

  it("returns null for a service whose provider has since been deactivated — the exact scenario this fix closes", async () => {
    // A real deactivated-provider service is simply never returned by
    // the (now-guarded) query — simulated here by the mock resolving
    // null, exactly what the guarded `where` clause would produce
    // against a real database.
    findFirstMock.mockResolvedValue(null);

    const result = await getServiceById(SERVICE_ID);

    expect(result).toBeNull();
  });

  it("returns null for an invalid id without querying the database", async () => {
    const result = await getServiceById("not-a-uuid");

    expect(result).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
