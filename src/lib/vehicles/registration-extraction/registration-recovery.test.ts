import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

// Phase 3C (incomplete native-PDF correction, 2026-10-09) — the service-level proofs of the two
// recovery paths, against a small IN-MEMORY database that honours what the service relies on: the
// unique front-document row, version CAS through updateMany, lease guards, and transaction
// ROLLBACK on a thrown audit. Synthetic text only; every external reading goes through a mocked
// reader; a global fetch guard fails the test on any real outbound request.

vi.mock("server-only", () => ({}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/storage/storage", () => ({ isDocumentStorageConfigured: () => true, downloadPrivateObject: async () => new ArrayBuffer(0) }));

const { runVehicleRegistrationExtraction, runRegistrationCompletion } = await import("./extract-registration-service");
const { REGISTRATION_PARSER_VERSION, MAX_OCR_CALLS_PER_DOCUMENT } = await import("./constants");
const { COMPLETION_APPLIED_WARNING, COMPLETION_FAILED_WARNING, FROM_COMPLETION_WARNING } = await import("./completion-merge");
const { suggestVehicleType } = await import("@/lib/vehicles/onboarding/vehicle-type-suggestion");

const OLD_VERSION = "1.1.0";
const ENGINE = "fake-reader/v1/p4";
const POLICY = { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "2026-10-09-v2", inferenceGeo: "us" as const };
const GRANTED = { state: "GRANTED" as const, policyVersion: POLICY.policyVersion, decidedAt: new Date() };
const NONE = { state: "NONE" as const, policyVersion: null, decidedAt: null };

// ── a tiny in-memory "prisma" ───────────────────────────────────────────────────────────────────
type Row = Record<string, unknown> & { id: string; assetDocumentId: string; assetId: string; version: number };
type Doc = { id: string; type: string; objectKey: string; mimeType: string; assetId: string; asset: { assetType: string; providerId: string } };

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v); // keeps Date objects, like Prisma does
}

function matches(row: Row, where: Record<string, unknown>, docs: Doc[]): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") {
      if (!(cond as Record<string, unknown>[]).some((c) => matches(row, c, docs))) return false;
      continue;
    }
    if (k === "asset") {
      const providerId = (cond as { providerId: string }).providerId;
      const d = docs.find((x) => x.id === row.assetDocumentId);
      if (!d || d.asset.providerId !== providerId) return false;
      continue;
    }
    const v = row[k];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("not" in c && v === c.not) return false;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
      if ("array_contains" in c && !(Array.isArray(v) && (c.array_contains as unknown[]).every((x) => (v as unknown[]).includes(x)))) return false;
      continue;
    }
    if (v !== cond && !(v === undefined && cond === null)) return false;
  }
  return true;
}

function applyData(row: Row, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) row[k] = (row[k] as number) + (v as { increment: number }).increment;
    else if (v === Prisma.JsonNull) row[k] = null;
    else row[k] = clone(v);
  }
}

function makeDb(docs: Doc[]) {
  let rows: Row[] = [];
  let seq = 0;
  const ext = {
    findUnique: async ({ where }: { where: { assetDocumentId?: string; id?: string } }) => {
      const r = rows.find((x) => (where.id ? x.id === where.id : x.assetDocumentId === where.assetDocumentId));
      return r ? clone(r) : null;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const r = rows.find((x) => matches(x, where, docs));
      return r ? clone(r) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (rows.some((x) => x.assetDocumentId === data.assetDocumentId)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" });
      const row = { id: `ext-${++seq}`, version: 0, ocrCallCount: null, processingToken: null, processingExpiresAt: null, ...clone(data) } as unknown as Row;
      for (const [k, v] of Object.entries(data)) if (v === Prisma.JsonNull) row[k] = null;
      rows.push(row);
      return clone(row);
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows.filter((x) => matches(x, where, docs));
      for (const r of hit) applyData(r, data);
      return { count: hit.length };
    },
  };
  const db = {
    assetDocument: {
      findUnique: async ({ where }: { where: { id: string } }) => clone(docs.find((d) => d.id === where.id) ?? null),
      findMany: async ({ where }: { where: { assetId: string } }) => docs.filter((d) => d.assetId === where.assetId).map((d) => ({ id: d.id, type: d.type, objectKey: d.objectKey, mimeType: d.mimeType })),
    },
    vehicleRegistrationExtraction: ext,
    $transaction: async (cb: (tx: unknown) => unknown) => {
      const snapshot = clone(rows);
      try {
        return await cb(db);
      } catch (error) {
        rows = snapshot; // ROLLBACK
        throw error;
      }
    },
  };
  return {
    db: db as never,
    rows: () => rows,
    seed: (row: Partial<Row>) => rows.push({ id: `ext-${++seq}`, version: 0, ocrCallCount: null, processingToken: null, processingExpiresAt: null, ...clone(row) } as Row),
    remove: (assetDocumentId: string) => (rows = rows.filter((r) => r.assetDocumentId !== assetDocumentId)),
  };
}

// ── synthetic documents ─────────────────────────────────────────────────────────────────────────
const PDF_BYTES = new TextEncoder().encode("%PDF-synthetic-registration").buffer;
const PDF_SHA = createHash("sha256").update(Buffer.from(PDF_BYTES)).digest("hex");
const pdfDoc = (id: string, assetId: string, providerId = "prov-1"): Doc => ({ id, type: "VEHICLE_REGISTRATION", objectKey: `k/${id}.pdf`, mimeType: "application/pdf", assetId, asset: { assetType: "VEHICLE", providerId } });
const lines = (desc: string, extra: string[] = []) => ["نوع المركبة: " + desc, "الموديل: 2019", "اللون: أبيض", "عدد الركاب: 5", ...extra].join("\n");

/** The exact staging shape: description + year + colour stored, make and model UNRESOLVED. */
function staleIncompleteFields(desc: string) {
  const missing = { rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] };
  const f: Record<string, unknown> = {};
  for (const k of ["plateNumber", "plateType", "makeDescription", "model", "usageClassification", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "registeredSeats", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"]) f[k] = missing;
  f.vehicleDescription = { rawValue: desc, normalizedValue: desc, confidence: "HIGH", warnings: [] };
  f.manufactureYear = { rawValue: "2019", normalizedValue: 2019, confidence: "HIGH", warnings: [] };
  f.color = { rawValue: "أبيض", normalizedValue: "أبيض", confidence: "HIGH", warnings: [] };
  f.licensedPassengerCapacity = { rawValue: "5", normalizedValue: 5, confidence: "HIGH", warnings: [] };
  return f;
}

function makeReader(result: () => Promise<unknown> | unknown = () => ({ ok: true, candidates: { makeDescription: [{ text: "Mazda" }], model: [{ text: "6" }] }, inferenceGeo: "us" })) {
  const read = vi.fn(async () => (await result()) as never);
  return { reader: { engine: ENGINE, inferenceGeo: "us", read }, read };
}

function deps(db: never, opts: { text?: string; reader?: ReturnType<typeof makeReader>["reader"] | null; consent?: unknown; budget?: "ALLOWED" | "LIMITED" } = {}) {
  const extractPdfText = vi.fn(async () => ({ ok: true as const, pageCount: 2, text: opts.text ?? lines("صالون مازدا6") }));
  return {
    extractPdfText,
    deps: {
      db,
      extractPdfText,
      downloadPrivateObject: vi.fn(async () => PDF_BYTES),
      isStorageConfigured: () => true,
      getReader: () => (opts.reader === undefined ? null : opts.reader),
      getPolicy: () => (opts.reader ? POLICY : null),
      readConsent: vi.fn(async () => (opts.consent ?? NONE) as never),
      consumeOcrBudget: vi.fn(async () => opts.budget ?? ("ALLOWED" as const)),
    },
  };
}

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
beforeEach(() => {
  vi.clearAllMocks();
  auditMock.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchGuard);
});
afterEach(() => {
  expect(fetchGuard).not.toHaveBeenCalled(); // no real outbound request, ever
  vi.unstubAllGlobals();
});

describe("versioning and reuse", () => {
  it("1/6. current semantic version + same set hash → the stored result is reused: no re-parse, no write (reload never reprocesses)", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    m.seed({ assetDocumentId: "doc-1", assetId: "a-1", documentSha256: PDF_SHA, parserVersion: REGISTRATION_PARSER_VERSION, status: "NEEDS_REVIEW", source: "NATIVE_PDF_TEXT", fields: staleIncompleteFields("x"), warnings: [] });
    const d = deps(m.db);
    for (let i = 0; i < 3; i++) {
      const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never);
      expect(res).toMatchObject({ ok: true, idempotent: true });
    }
    expect(d.extractPdfText).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("2. an OLDER semantic version + the same set hash is NOT reused as current: the document is parsed again under the current rules", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    m.seed({ assetDocumentId: "doc-1", assetId: "a-1", documentSha256: PDF_SHA, parserVersion: OLD_VERSION, status: "NEEDS_REVIEW", source: "NATIVE_PDF_TEXT", fields: staleIncompleteFields("صالون مازدا6"), warnings: [] });
    const d = deps(m.db);
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never);
    expect(res).toMatchObject({ ok: true, idempotent: false });
    expect(d.extractPdfText).toHaveBeenCalledTimes(1);
    expect(m.rows()[0]!.parserVersion).toBe(REGISTRATION_PARSER_VERSION);
  });

  it("8. the OCR engine/prompt identity is a SEPARATE axis: an automatic reading of the same bytes by the same engine under an OLDER semantic version is never reused across uploads", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1"), pdfDoc("doc-2", "a-2")]);
    m.seed({ assetDocumentId: "doc-2", assetId: "a-2", documentSha256: PDF_SHA, parserVersion: OLD_VERSION, status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE, fields: staleIncompleteFields("مازدا صالون 6"), warnings: [] });
    const { reader, read } = makeReader();
    const d = deps(m.db, { text: "no usable text", reader, consent: GRANTED });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never);
    expect(res.ok).toBe(true);
    expect(read).toHaveBeenCalledTimes(1); // a fresh reading — the old-version row was not copied
    expect(m.rows().find((r) => r.assetDocumentId === "doc-1")!.warnings).not.toContain("REUSED_IDENTICAL_DOCUMENT");
  });

  it("a STALE stored automatic reading of the same set is re-derived LOCALLY (no new external request) — also on an upload replay", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    m.seed({ assetDocumentId: "doc-1", assetId: "a-1", documentSha256: PDF_SHA, parserVersion: OLD_VERSION, status: "NEEDS_REVIEW", source: "OCR", ocrEngine: ENGINE, ocrInferenceGeo: "us", fields: staleIncompleteFields("صالون مازدا6"), warnings: ["NATIVE_TEXT_UNUSABLE"] });
    const { reader, read } = makeReader();
    const d = deps(m.db, { text: "no usable text", reader, consent: GRANTED });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never);
    expect(res).toMatchObject({ ok: true, idempotent: false });
    expect(read).not.toHaveBeenCalled();
    const row = m.rows()[0]!;
    expect(row.parserVersion).toBe(REGISTRATION_PARSER_VERSION);
    expect((row.fields as Record<string, { normalizedValue: unknown }>).makeDescription!.normalizedValue).toBe("Mazda");
    expect(row.warnings).toEqual(expect.arrayContaining(["NATIVE_TEXT_UNUSABLE", "REDERIVED_LOCALLY"]));
    expect((auditMock.mock.calls[0]![0] as { newValue: Record<string, unknown> }).newValue).toMatchObject({ localRederive: true, externalCall: false });
  });
});

describe("staging-failure regression (synthetic) — local re-read of a stale, incomplete PDF reading", () => {
  it("9–14. stored: description + year + colour + Sedan hint, make/model unresolved → local re-read under the new version suggests make and model; the type stays a suggestion; the description stays private; no outbound request", async () => {
    const desc = "صالون مازدا6";
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    m.seed({ assetDocumentId: "doc-1", assetId: "a-1", documentSha256: PDF_SHA, parserVersion: OLD_VERSION, status: "NEEDS_REVIEW", source: "NATIVE_PDF_TEXT", fields: staleIncompleteFields(desc), warnings: [] });
    // 9. the staging shape: the Sedan hint is computed live from the stored description.
    expect(suggestVehicleType(desc)).toBe("SEDAN");
    const { reader, read } = makeReader();
    const d = deps(m.db, { text: lines(desc), reader, consent: GRANTED });
    // 10. re-analyse under the new version — LOCAL ONLY, even with consent on record.
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never, { localOnly: true });
    expect(res).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: false });
    const f = m.rows()[0]!.fields as Record<string, { normalizedValue: unknown; confidence: string; warnings: string[] }>;
    // 11. make and model are now suggested — LOW + HEURISTIC_SPLIT.
    expect(f.makeDescription).toMatchObject({ normalizedValue: "Mazda", confidence: "LOW" });
    expect(f.makeDescription!.warnings).toContain("HEURISTIC_SPLIT");
    expect(f.model!).toMatchObject({ normalizedValue: "6", confidence: "LOW" });
    // 12. the type is NOT a field of the reading at all — it stays a suggestion computed for review.
    expect(Object.keys(f)).not.toContain("vehicleType");
    // 13. the original description is kept whole, privately.
    expect(f.vehicleDescription!.normalizedValue).toBe(desc);
    expect(f.manufactureYear!.normalizedValue).toBe(2019);
    // 14. no outbound request (reader untouched; the fetch guard is checked after each test).
    expect(read).not.toHaveBeenCalled();
  });

  it("4/5. concurrent local re-reads converge on ONE current result (one write, one audit)", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    m.seed({ assetDocumentId: "doc-1", assetId: "a-1", documentSha256: PDF_SHA, parserVersion: OLD_VERSION, status: "NEEDS_REVIEW", source: "NATIVE_PDF_TEXT", fields: staleIncompleteFields("صالون مازدا6"), warnings: [] });
    const d = deps(m.db);
    const [a, b] = await Promise.all([
      runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never, { localOnly: true }),
      runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never, { localOnly: true }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((r) => r.ok && !r.idempotent)).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(m.rows()).toHaveLength(1);
    expect(m.rows()[0]!.parserVersion).toBe(REGISTRATION_PARSER_VERSION);
  });

  it("a local re-read whose text yields nothing usable leaves the stored reading untouched (never a downgrade) and calls nobody", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    m.seed({ assetDocumentId: "doc-1", assetId: "a-1", documentSha256: PDF_SHA, parserVersion: OLD_VERSION, status: "NEEDS_REVIEW", source: "NATIVE_PDF_TEXT", fields: staleIncompleteFields("x"), warnings: [] });
    const { reader, read } = makeReader();
    const d = deps(m.db, { text: "nothing here", reader, consent: GRANTED });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never, { localOnly: true });
    expect(res).toMatchObject({ ok: true, idempotent: true });
    expect(m.rows()[0]!.parserVersion).toBe(OLD_VERSION);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("optional completion of an incomplete native-PDF reading", () => {
  /** A CURRENT native reading that misses make/model (an unknown manufacturer in the description). */
  function incompleteCurrent(m: ReturnType<typeof makeDb>, assetDocumentId = "doc-1", assetId = "a-1", over: Record<string, unknown> = {}) {
    m.seed({ assetDocumentId, assetId, documentSha256: PDF_SHA, parserVersion: REGISTRATION_PARSER_VERSION, status: "NEEDS_REVIEW", source: "NATIVE_PDF_TEXT", fields: staleIncompleteFields("فلان صالون 9"), warnings: [], ...over });
  }

  it("16/17. NO call before an explicit GRANTED consent for this set — upload/reload/retry never grant it", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    const { reader, read } = makeReader();
    for (const consent of [NONE, { state: "DECLINED", policyVersion: POLICY.policyVersion, decidedAt: new Date() }]) {
      const d = deps(m.db, { reader, consent });
      expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never)).toEqual({ ok: false, error: "CONSENT_REQUIRED" });
    }
    // A plain re-analysis (what an upload replay / reload / retry runs) never sends a current PDF.
    const d = deps(m.db, { reader, consent: GRANTED });
    await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, d.deps as never);
    expect(read).not.toHaveBeenCalled();
  });

  it("18/19. a consent for an OLDER notice version (STALE) or for another file is not accepted", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    const { reader, read } = makeReader();
    const stale = deps(m.db, { reader, consent: { state: "STALE", policyVersion: "2026-10-07-v1", decidedAt: new Date() } });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, stale.deps as never)).toEqual({ ok: false, error: "CONSENT_REQUIRED" });
    expect(read).not.toHaveBeenCalled();
    // The service asks for the consent of THIS exact set hash.
    const g = deps(m.db, { reader, consent: GRANTED });
    await runRegistrationCompletion({ assetDocumentId: "doc-1" }, g.deps as never);
    expect(g.deps.readConsent).toHaveBeenCalledWith(expect.anything(), { providerId: "prov-1", assetDocumentId: "doc-1", documentSha256: PDF_SHA }, POLICY);
  });

  it("21/22/29. one PDF (two printed pages) → EXACTLY ONE request with ONE page entry; the reading fills make/model as reviewable suggestions", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    const { reader, read } = makeReader();
    const d = deps(m.db, { reader, consent: GRANTED });
    const res = await runRegistrationCompletion({ assetDocumentId: "doc-1", actorUserId: "u-1" }, d.deps as never);
    expect(res).toMatchObject({ ok: true, outcome: "COMPLETED" });
    expect(read).toHaveBeenCalledTimes(1);
    const input = (read.mock.calls[0] as unknown[])[0] as { pages: { mimeType: string }[] };
    expect(input.pages).toHaveLength(1);
    expect(input.pages[0]!.mimeType).toBe("application/pdf");
    expect(d.deps.consumeOcrBudget).toHaveBeenCalledTimes(1);
    const row = m.rows()[0]!;
    const f = row.fields as Record<string, { normalizedValue: unknown; confidence: string; warnings: string[] }>;
    expect(f.makeDescription!.normalizedValue).toBe("Mazda");
    expect(f.model!.normalizedValue).toBe("6");
    expect(f.makeDescription!.warnings).toContain(FROM_COMPLETION_WARNING);
    expect(f.makeDescription!.confidence).not.toBe("HIGH");
    expect(row.status).toBe("NEEDS_REVIEW");
    expect(row.source).toBe("NATIVE_PDF_TEXT");
    expect(row.warnings).toContain(COMPLETION_APPLIED_WARNING);
    expect(row.processingToken).toBeNull();
    expect(row.ocrCallCount).toBe(1);
    expect(f.vehicleDescription!.normalizedValue).toBe("فلان صالون 9"); // local private description kept
  });

  it("23. duplicate clicks and concurrent attempts → ONE effective call", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { reader, read } = makeReader(async () => {
      await gate;
      return { ok: true, candidates: { makeDescription: [{ text: "Mazda" }], model: [{ text: "6" }] }, inferenceGeo: "us" };
    });
    const d = deps(m.db, { reader, consent: GRANTED });
    const first = runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const second = await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never);
    expect(second).toMatchObject({ ok: true, outcome: "IN_PROGRESS" });
    release();
    expect(await first).toMatchObject({ ok: true, outcome: "COMPLETED" });
    const third = await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never);
    expect(third).toMatchObject({ ok: true, outcome: "ALREADY_COMPLETED" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("24. a successful completion is REUSED for the same bytes uploaded again by the same provider — no second request; never across providers", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1"), pdfDoc("doc-2", "a-2"), pdfDoc("doc-3", "a-3", "prov-OTHER")]);
    incompleteCurrent(m, "doc-1", "a-1");
    incompleteCurrent(m, "doc-2", "a-2");
    incompleteCurrent(m, "doc-3", "a-3");
    const { reader, read } = makeReader();
    const d = deps(m.db, { reader, consent: GRANTED });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never)).toMatchObject({ outcome: "COMPLETED" });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-2" }, d.deps as never)).toMatchObject({ outcome: "REUSED" });
    expect(read).toHaveBeenCalledTimes(1);
    // Another provider with identical bytes gets its OWN reading (and needs its own consent).
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-3" }, d.deps as never)).toMatchObject({ outcome: "COMPLETED" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("25. timeout / provider failure → the local reading is preserved exactly, the lease is released, the failure is marked", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    const before = JSON.stringify(m.rows()[0]!.fields);
    const { reader } = makeReader(() => ({ ok: false, code: "OCR_TIMEOUT" }));
    const d = deps(m.db, { reader, consent: GRANTED });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never)).toEqual({ ok: false, error: "READ_FAILED" });
    const row = m.rows()[0]!;
    expect(JSON.stringify(row.fields)).toBe(before);
    expect(row.processingToken).toBeNull();
    expect(row.status).toBe("NEEDS_REVIEW");
    expect(row.warnings).toContain(COMPLETION_FAILED_WARNING);
    expect(row.warnings).not.toContain(COMPLETION_APPLIED_WARNING);
  });

  it("26. cancellation (row deleted) or replacement (set re-read, lease cleared) during the request → the late answer is DISCARDED", async () => {
    for (const race of ["CANCEL", "REPLACE"] as const) {
      const m = makeDb([pdfDoc("doc-1", "a-1")]);
      incompleteCurrent(m);
      const { reader } = makeReader(async () => {
        if (race === "CANCEL") m.remove("doc-1");
        else Object.assign(m.rows()[0]!, { documentSha256: "other-set", processingToken: null, processingExpiresAt: null, version: 99 });
        return { ok: true, candidates: { makeDescription: [{ text: "Mazda" }] }, inferenceGeo: "us" };
      });
      const d = deps(m.db, { reader, consent: GRANTED });
      const res = await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never);
      expect(res.ok).toBe(false);
      if (race === "REPLACE") expect(m.rows()[0]!.warnings).not.toContain(COMPLETION_APPLIED_WARNING);
      else expect(m.rows()).toHaveLength(0);
      expect(auditMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: "vehicle.registration_completion", newValue: expect.objectContaining({ outcome: "COMPLETED" }) }), expect.anything());
    }
  });

  it("27. an AUDIT failure rolls the merge back: completion is NOT marked successful and the local reading is unchanged", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    const before = JSON.stringify(m.rows()[0]!.fields);
    auditMock.mockRejectedValueOnce(new Error("audit store down"));
    const { reader } = makeReader();
    const d = deps(m.db, { reader, consent: GRANTED });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never)).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    const row = m.rows()[0]!;
    expect(JSON.stringify(row.fields)).toBe(before);
    expect(row.warnings).not.toContain(COMPLETION_APPLIED_WARNING);
    expect(row.processingToken).toBeNull();
  });

  it("28. budget denial and the per-document ceiling are fail-closed: no request, local reading kept", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1"), pdfDoc("doc-2", "a-2")]);
    incompleteCurrent(m, "doc-1", "a-1");
    incompleteCurrent(m, "doc-2", "a-2", { ocrCallCount: MAX_OCR_CALLS_PER_DOCUMENT });
    const { reader, read } = makeReader();
    const limited = deps(m.db, { reader, consent: GRANTED, budget: "LIMITED" });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, limited.deps as never)).toEqual({ ok: false, error: "RATE_LIMITED" });
    const thrown = deps(m.db, { reader, consent: GRANTED });
    thrown.deps.consumeOcrBudget.mockRejectedValueOnce(new Error("limiter down"));
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, thrown.deps as never)).toEqual({ ok: false, error: "RATE_LIMITED" });
    const capped = deps(m.db, { reader, consent: GRANTED });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-2" }, capped.deps as never)).toEqual({ ok: false, error: "ATTEMPT_LIMIT" });
    expect(read).not.toHaveBeenCalled();
    expect(m.rows()[0]!.processingToken).toBeNull();
  });

  it("only a CURRENT, INCOMPLETE native-PDF reading may be completed: stale → RESULT_STALE; complete → NOT_NEEDED; photos / OCR rows → NOT_APPLICABLE; not configured → OCR_NOT_AVAILABLE", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1"), pdfDoc("doc-2", "a-2"), pdfDoc("doc-3", "a-3"), { ...pdfDoc("doc-4", "a-4"), mimeType: "image/jpeg" }]);
    incompleteCurrent(m, "doc-1", "a-1", { parserVersion: OLD_VERSION });
    const complete = staleIncompleteFields("مازدا صالون 6");
    complete.makeDescription = { rawValue: "x", normalizedValue: "Mazda", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] };
    complete.model = { rawValue: "x", normalizedValue: "6", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] };
    incompleteCurrent(m, "doc-2", "a-2", { fields: complete });
    incompleteCurrent(m, "doc-3", "a-3", { source: "OCR" });
    const { reader, read } = makeReader();
    const d = deps(m.db, { reader, consent: GRANTED });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never)).toEqual({ ok: false, error: "RESULT_STALE" });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-2" }, d.deps as never)).toEqual({ ok: false, error: "NOT_NEEDED" });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-3" }, d.deps as never)).toEqual({ ok: false, error: "NOT_APPLICABLE" });
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-4" }, d.deps as never)).toEqual({ ok: false, error: "NOT_APPLICABLE" });
    const off = deps(m.db, { reader: null, consent: GRANTED });
    incompleteCurrent(m, "doc-5", "a-5");
    expect(await runRegistrationCompletion({ assetDocumentId: "doc-1" }, off.deps as never)).toEqual({ ok: false, error: "RESULT_STALE" });
    expect(read).not.toHaveBeenCalled();
  });

  it("the completion audit carries metadata only — counts, engine, geography, request — never a document value", async () => {
    const m = makeDb([pdfDoc("doc-1", "a-1")]);
    incompleteCurrent(m);
    const { reader } = makeReader();
    const d = deps(m.db, { reader, consent: GRANTED });
    await runRegistrationCompletion({ assetDocumentId: "doc-1" }, d.deps as never);
    const audit = auditMock.mock.calls.map((c) => (c as unknown[])[0] as { action: string; newValue: Record<string, unknown> }).find((a) => a.action === "vehicle.registration_completion")!;
    expect(audit.newValue).toMatchObject({ outcome: "COMPLETED", externalCall: true, aiAssisted: true, fieldsFilled: 2, confidence: "SUGGESTION_REQUIRES_PROVIDER_REVIEW" });
    expect(JSON.stringify(audit)).not.toMatch(/Mazda|فلان|أبيض|2019/);
  });
});
