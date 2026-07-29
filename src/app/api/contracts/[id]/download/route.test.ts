import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Phase E.3 — regression tests for GET /api/contracts/[id]/download:
// mirrors src/app/api/bookings/[id]/history/route.test.ts's (Phase
// E.1) exact pattern — uniform 404 for a nonexistent contract AND for
// one belonging to neither the requester's customer nor provider
// profile, success for the owning customer/provider/an admin, and a
// clear, non-404 status when the contract has no content yet.
//
// Provider-deactivation gap fix — this route now resolves provider
// identity via the shared resolveProviderStatus() guard
// (src/lib/auth/rbac.ts) instead of a raw, unguarded
// prisma.provider.findUnique() call. Mocked directly here (rather than
// re-testing its internal status classification, which rbac.test.ts's
// own requireProvider() coverage already exercises) so these tests stay
// focused on this route's own new branching: a 403 for an owning
// provider whose account is DEACTIVATED/SUSPENDED, distinct from the
// uniform 404 used everywhere else.

const requireAuthMock = vi.fn();
const findUniqueContractMock = vi.fn();
const findUniqueCustomerMock = vi.fn();
const resolveProviderStatusMock = vi.fn();
const findUniqueAdminMock = vi.fn();
const getContractPdfForDownloadMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  withApiAuth: async (handler: () => Promise<unknown>) => handler(),
  resolveProviderStatus: (...args: unknown[]) => resolveProviderStatusMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: { findUnique: (...args: unknown[]) => findUniqueContractMock(...args) },
    customer: { findUnique: (...args: unknown[]) => findUniqueCustomerMock(...args) },
    admin: { findUnique: (...args: unknown[]) => findUniqueAdminMock(...args) },
  },
}));

vi.mock("@/lib/contracts/execution", () => ({
  getContractPdfForDownload: (...args: unknown[]) => getContractPdfForDownloadMock(...args),
  ContractNotYetGeneratedError: class ContractNotYetGeneratedError extends Error {},
}));

vi.mock("@/lib/contracts/lifecycle", () => ({
  BookingContractNotFoundError: class BookingContractNotFoundError extends Error {},
}));

const { GET } = await import("./route");
const { ContractNotYetGeneratedError } = await import("@/lib/contracts/execution");

const CONTRACT_ID = "11111111-1111-1111-1111-111111111111";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/contracts/[id]/download", () => {
  it("returns 404 for a non-UUID id without querying the database", async () => {
    const response = await GET(new Request("http://localhost"), makeParams("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(findUniqueContractMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the contract does not exist", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueContractMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));
    expect(response.status).toBe(404);
  });

  it("returns 404 when the contract belongs to neither the requester's customer nor provider profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueContractMock.mockResolvedValue({
      id: CONTRACT_ID,
      contractNumber: "BARQ-2026-000001",
      booking: { customerId: "someone-elses-customer", providerId: "someone-elses-provider" },
    });
    findUniqueCustomerMock.mockResolvedValue(null);
    resolveProviderStatusMock.mockResolvedValue({ kind: "not_found" });
    findUniqueAdminMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));
    expect(response.status).toBe(404);
    expect(getContractPdfForDownloadMock).not.toHaveBeenCalled();
  });

  it("returns the PDF for the owning customer with correct headers", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueContractMock.mockResolvedValue({
      id: CONTRACT_ID,
      contractNumber: "BARQ-2026-000001",
      booking: { customerId: "customer-1", providerId: "provider-1" },
    });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    resolveProviderStatusMock.mockResolvedValue({ kind: "not_found" });
    findUniqueAdminMock.mockResolvedValue(null);
    getContractPdfForDownloadMock.mockResolvedValue({
      pdf: Buffer.from("%PDF-1.4 fake"),
      contractNumber: "BARQ-2026-000001",
    });

    const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("BARQ-2026-000001.pdf");
  });

  it("returns 409 when the contract has no generated content yet", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueContractMock.mockResolvedValue({
      id: CONTRACT_ID,
      contractNumber: "BARQ-2026-000001",
      booking: { customerId: "customer-1", providerId: "provider-1" },
    });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    resolveProviderStatusMock.mockResolvedValue({ kind: "not_found" });
    findUniqueAdminMock.mockResolvedValue(null);
    getContractPdfForDownloadMock.mockRejectedValue(new ContractNotYetGeneratedError("not generated"));

    const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));
    expect(response.status).toBe(409);
  });

  describe("provider-deactivation gap fix", () => {
    it("returns the PDF for the owning provider whose account is APPROVED (active)", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueContractMock.mockResolvedValue({
        id: CONTRACT_ID,
        contractNumber: "BARQ-2026-000001",
        booking: { customerId: "customer-1", providerId: "provider-1" },
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "active",
        provider: { id: "provider-1", status: "APPROVED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);
      getContractPdfForDownloadMock.mockResolvedValue({
        pdf: Buffer.from("%PDF-1.4 fake"),
        contractNumber: "BARQ-2026-000001",
      });

      const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
    });

    it("returns 403 Forbidden for the owning provider whose account is DEACTIVATED", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueContractMock.mockResolvedValue({
        id: CONTRACT_ID,
        contractNumber: "BARQ-2026-000001",
        booking: { customerId: "customer-1", providerId: "provider-1" },
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "inactive",
        provider: { id: "provider-1", status: "DEACTIVATED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("Forbidden");
      expect(getContractPdfForDownloadMock).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden for the owning provider whose account is SUSPENDED", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueContractMock.mockResolvedValue({
        id: CONTRACT_ID,
        contractNumber: "BARQ-2026-000001",
        booking: { customerId: "customer-1", providerId: "provider-1" },
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "inactive",
        provider: { id: "provider-1", status: "SUSPENDED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("Forbidden");
      expect(getContractPdfForDownloadMock).not.toHaveBeenCalled();
    });

    it("returns 404 (not 403) for a DEACTIVATED provider who does not own this contract — unauthorized users still get the uniform not-found", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueContractMock.mockResolvedValue({
        id: CONTRACT_ID,
        contractNumber: "BARQ-2026-000001",
        booking: { customerId: "customer-1", providerId: "someone-elses-provider" },
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "inactive",
        provider: { id: "provider-1", status: "DEACTIVATED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost"), makeParams(CONTRACT_ID));

      expect(response.status).toBe(404);
      expect(getContractPdfForDownloadMock).not.toHaveBeenCalled();
    });
  });
});
