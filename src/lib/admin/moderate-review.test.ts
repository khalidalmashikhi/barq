import { describe, it, expect, vi, afterEach } from "vitest";

// REVIEW TRUST & SAFETY — domain tests for moderateReview(). Covers authority, IDOR-safe resolution,
// the transition guard, guarded-write concurrency, the in-tx audit (state + reason, never content),
// and that moderation never hard-deletes.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));

const requireAdminMock = vi.fn();
class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));

const findUniqueMock = vi.fn();
const updateManyMock = vi.fn();
const reviewDeleteMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    review: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
      delete: (...a: unknown[]) => reviewDeleteMock(...a),
    },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        review: { updateMany: (...a: unknown[]) => updateManyMock(...a), delete: (...a: unknown[]) => reviewDeleteMock(...a) },
      }),
  },
}));

const { moderateReview } = await import("./moderate-review");

const REVIEW_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  requireAdminMock.mockReset();
  auditMock.mockReset();
  findUniqueMock.mockReset();
  updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  reviewDeleteMock.mockReset();
});

describe("moderateReview — authority & input", () => {
  it("INVALID_INPUT for a malformed reviewId (no admin lookup)", async () => {
    expect(await moderateReview("nope", form({ action: "FLAG" }))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("INVALID_INPUT for an unknown/absent action (no arbitrary state write)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    expect(await moderateReview(REVIEW_ID, form({ action: "PUBLISH" }))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await moderateReview(REVIEW_ID, form({}))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("NO_ADMIN_PROFILE when the caller is not an admin (customer/provider/non-admin cannot moderate)", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await moderateReview(REVIEW_ID, form({ action: "REMOVE" }))).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an over-length reason", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    expect(await moderateReview(REVIEW_ID, form({ action: "FLAG", reason: "x".repeat(501) }))).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("moderateReview — resolution & transitions", () => {
  it("REVIEW_NOT_FOUND for an unknown review (no existence leak beyond the code)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await moderateReview(REVIEW_ID, form({ action: "FLAG" }))).toEqual({ ok: false, error: "REVIEW_NOT_FOUND" });
  });

  it("INVALID_TRANSITION when the action doesn't apply to the current state (e.g. FLAG an already-FLAGGED)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: REVIEW_ID, moderationState: "FLAGGED" });
    expect(await moderateReview(REVIEW_ID, form({ action: "FLAG" }))).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("FLAG: PUBLISHED → FLAGGED via a state-guarded update (never a hard delete), audited with state only", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: REVIEW_ID, moderationState: "PUBLISHED" });

    expect(await moderateReview(REVIEW_ID, form({ action: "FLAG", reason: "spam" }))).toEqual({ ok: true });

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: REVIEW_ID, moderationState: "PUBLISHED" }, // guarded on the state we validated
      data: { moderationState: "FLAGGED" },
    });
    expect(reviewDeleteMock).not.toHaveBeenCalled(); // NEVER a hard delete
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "review.flagged",
        entityType: "Review",
        entityId: REVIEW_ID,
        previousValue: { moderationState: "PUBLISHED" },
        newValue: { moderationState: "FLAGGED", reason: "spam" },
      }),
      expect.anything(),
    );
  });

  it.each([
    ["REMOVE", "PUBLISHED", "REMOVED", "review.removed"],
    ["REMOVE", "FLAGGED", "REMOVED", "review.removed"],
    ["RESTORE", "FLAGGED", "PUBLISHED", "review.restored"],
    ["RESTORE", "REMOVED", "PUBLISHED", "review.restored"],
  ] as const)("%s from %s → %s (audit %s)", async (action, current, target, auditAction) => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: REVIEW_ID, moderationState: current });
    expect(await moderateReview(REVIEW_ID, form({ action }))).toEqual({ ok: true });
    expect(updateManyMock).toHaveBeenCalledWith({ where: { id: REVIEW_ID, moderationState: current }, data: { moderationState: target } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: auditAction, newValue: { moderationState: target } }), expect.anything());
  });

  it("audit newValue omits reason when none is given (no empty-string noise)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: REVIEW_ID, moderationState: "PUBLISHED" });
    await moderateReview(REVIEW_ID, form({ action: "REMOVE" }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ newValue: { moderationState: "REMOVED" } }), expect.anything());
  });
});

describe("moderateReview — concurrency", () => {
  it("MODERATION_CONFLICT when a concurrent moderator already changed the state (guarded update matches 0 rows) — no audit", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: REVIEW_ID, moderationState: "PUBLISHED" });
    updateManyMock.mockResolvedValue({ count: 0 }); // lost the race

    expect(await moderateReview(REVIEW_ID, form({ action: "FLAG" }))).toEqual({ ok: false, error: "MODERATION_CONFLICT" });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("maps an unexpected DB failure to UNKNOWN_ERROR (no internal leak)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: REVIEW_ID, moderationState: "PUBLISHED" });
    updateManyMock.mockRejectedValue(new Error("db exploded"));
    expect(await moderateReview(REVIEW_ID, form({ action: "FLAG" }))).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});
