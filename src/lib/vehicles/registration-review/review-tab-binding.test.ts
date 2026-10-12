import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { reviewTabBinding } from "./review-tab-binding";

// 2026-10-12 — the opaque binding of the review form's tab memory. Synthetic ids / values only.

const base = {
  providerId: "0190aaaa-0000-7000-8000-000000000001",
  userId: "0190aaaa-0000-7000-8000-0000000000u1",
  documentIds: ["0190dddd-0000-7000-8000-000000000001"],
  extraction: { id: "0190eeee-0000-7000-8000-000000000001", documentSha256: "a".repeat(64), parserVersion: "1.2.0", lastSucceededAt: new Date("2026-10-12T10:00:00Z") },
  extractedValues: [
    { key: "make", extractedValue: "Mazda", alternatives: [] },
    { key: "plateNumber", extractedValue: "T 99002", alternatives: [] },
  ],
};

describe("reviewTabBinding", () => {
  it("is deterministic for the same provider and the same reading (a language switch keeps it)", () => {
    expect(reviewTabBinding(base)).toEqual(reviewTabBinding({ ...base, documentIds: [...base.documentIds] }));
  });

  it("6. another provider or another account → another identity", () => {
    const a = reviewTabBinding(base);
    expect(reviewTabBinding({ ...base, providerId: "0190aaaa-0000-7000-8000-000000000002" }).identity).not.toBe(a.identity);
    expect(reviewTabBinding({ ...base, userId: "0190aaaa-0000-7000-8000-0000000000u2" }).identity).not.toBe(a.identity);
  });

  it("7. a replaced document, a re-read, a new semantic version or any new result → another source", () => {
    const a = reviewTabBinding(base).source;
    expect(reviewTabBinding({ ...base, documentIds: ["0190dddd-0000-7000-8000-000000000002"] }).source).not.toBe(a);
    expect(reviewTabBinding({ ...base, documentIds: [...base.documentIds, "0190dddd-0000-7000-8000-00000000back"] }).source).not.toBe(a);
    expect(reviewTabBinding({ ...base, extraction: { ...base.extraction, lastSucceededAt: new Date("2026-10-12T11:00:00Z") } }).source).not.toBe(a);
    expect(reviewTabBinding({ ...base, extraction: { ...base.extraction, documentSha256: "b".repeat(64) } }).source).not.toBe(a);
    expect(reviewTabBinding({ ...base, extraction: { ...base.extraction, parserVersion: "1.3.0" } }).source).not.toBe(a);
    expect(reviewTabBinding({ ...base, extractedValues: [{ key: "make", extractedValue: "Toyota", alternatives: [] }, base.extractedValues[1]!] }).source).not.toBe(a);
    expect(reviewTabBinding({ ...base, extraction: null }).source).not.toBe(a);
  });

  it("the provider's identity does not change the source, and the reading does not change the identity", () => {
    const a = reviewTabBinding(base);
    const b = reviewTabBinding({ ...base, providerId: "0190aaaa-0000-7000-8000-000000000002", extraction: { ...base.extraction, lastSucceededAt: new Date(0) } });
    expect(b.identity).not.toBe(a.identity);
    expect(reviewTabBinding({ ...base, providerId: "0190aaaa-0000-7000-8000-000000000002" }).source).toBe(a.source);
  });

  it("11. carries only two opaque hashes — no raw id, no document value", () => {
    const serialized = JSON.stringify(reviewTabBinding(base));
    for (const raw of [base.providerId, base.userId, base.documentIds[0]!, base.extraction.id, "a".repeat(64), "T 99002", "Mazda", "1.2.0"]) expect(serialized).not.toContain(raw);
    expect(reviewTabBinding(base).identity).toMatch(/^[0-9a-f]{32}$/);
    expect(reviewTabBinding(base).source).toMatch(/^[0-9a-f]{32}$/);
  });
});
