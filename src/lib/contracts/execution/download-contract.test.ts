import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for getContractPdfForDownload():
// rejects a nonexistent contract, rejects one with no generated
// content yet (ContractNotYetGeneratedError), and on success returns
// real PDF bytes while reusing Phase E.2's recordContractDownloaded()
// (not a duplicate implementation).

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const recordContractDownloadedMock = vi.fn();
const generateContractPdfMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { bookingContract: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

vi.mock("../record-contract-downloaded", () => ({
  recordContractDownloaded: (...args: unknown[]) => recordContractDownloadedMock(...args),
}));

vi.mock("../pdf/generate-contract-pdf", () => ({
  generateContractPdf: (...args: unknown[]) => generateContractPdfMock(...args),
}));

const { getContractPdfForDownload } = await import("./download-contract");
const { BookingContractNotFoundError } = await import("../lifecycle");
const { ContractNotYetGeneratedError } = await import("./errors");

afterEach(() => {
  findUniqueMock.mockReset();
  recordContractDownloadedMock.mockReset();
  generateContractPdfMock.mockReset();
});

describe("getContractPdfForDownload", () => {
  it("throws BookingContractNotFoundError for a nonexistent contract", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      getContractPdfForDownload({ contractId: "missing", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(BookingContractNotFoundError);
  });

  it("throws ContractNotYetGeneratedError when content is still null (still DRAFT)", async () => {
    findUniqueMock.mockResolvedValue({ id: "contract-1", contractNumber: "BARQ-2026-000001", content: null });

    await expect(
      getContractPdfForDownload({ contractId: "contract-1", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(ContractNotYetGeneratedError);
    expect(recordContractDownloadedMock).not.toHaveBeenCalled();
  });

  it("returns PDF bytes and the contract number, and records the download via Phase E.2's existing function", async () => {
    findUniqueMock.mockResolvedValue({
      id: "contract-1",
      contractNumber: "BARQ-2026-000001",
      content: { title: { ar: "عنوان", en: "Title" }, sections: [] },
    });
    generateContractPdfMock.mockReturnValue(Buffer.from("%PDF-1.4 fake"));
    recordContractDownloadedMock.mockResolvedValue(undefined);

    const result = await getContractPdfForDownload({
      contractId: "contract-1",
      actorType: "CUSTOMER",
      actorId: "customer-1",
    });

    expect(result.contractNumber).toBe("BARQ-2026-000001");
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(recordContractDownloadedMock).toHaveBeenCalledWith({
      contractId: "contract-1",
      actorType: "CUSTOMER",
      actorId: "customer-1",
    });
  });
});
