import { describe, it, expect } from "vitest";
import { resolveNotificationAction } from "./resolve-notification-action";

// Gate B3 — the safe CTA resolver. It is a pure allowlist: routing is keyed on
// eventType (which carries a fixed audience), the only interpolated value is a
// strict-UUID-validated providerId, and an unknown/legacy/invalid input yields
// null (no CTA). No raw href is ever read from input.

const UUID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

describe("resolveNotificationAction — ADMIN events → admin provider detail", () => {
  it.each([
    ["provider.verification_submitted", "ctaReviewApplication"],
    ["provider.changes_resubmitted", "ctaReviewApplication"],
    ["provider.document_uploaded", "ctaReviewDocument"],
    ["provider.document_replaced", "ctaReviewDocument"],
  ])("%s → /admin/providers/[id] with %s", (eventType, labelKey) => {
    const action = resolveNotificationAction({ eventType, entityType: "Provider", entityId: UUID });
    expect(action).toEqual({ labelKey, href: `/admin/providers/${UUID}` });
  });
});

describe("resolveNotificationAction — PROVIDER events → fixed self-scoped routes", () => {
  it("provider.approved → /provider (Browse your workspace)", () => {
    expect(resolveNotificationAction({ eventType: "provider.approved", entityType: "Provider", entityId: UUID })).toEqual({
      labelKey: "ctaBrowseWorkspace",
      href: "/provider",
    });
  });
  it("provider.changes_requested → /provider/verification (Review required changes)", () => {
    expect(resolveNotificationAction({ eventType: "provider.changes_requested", entityType: "Provider", entityId: UUID })).toEqual({
      labelKey: "ctaReviewChanges",
      href: "/provider/verification",
    });
  });
  it("provider.document_rejected → /provider/verification (Review document)", () => {
    expect(resolveNotificationAction({ eventType: "provider.document_rejected", entityType: "Provider", entityId: UUID })).toEqual({
      labelKey: "ctaReviewDocument",
      href: "/provider/verification",
    });
  });
  it("provider.rejected → /provider-application (View application status)", () => {
    expect(resolveNotificationAction({ eventType: "provider.rejected", entityType: "Provider", entityId: UUID })).toEqual({
      labelKey: "ctaViewApplicationStatus",
      href: "/provider-application",
    });
  });
});

describe("resolveNotificationAction — safety / null cases", () => {
  it("admin event with an INVALID UUID entityId → null (no unsafe interpolation)", () => {
    expect(resolveNotificationAction({ eventType: "provider.verification_submitted", entityType: "Provider", entityId: "not-a-uuid" })).toBeNull();
    expect(resolveNotificationAction({ eventType: "provider.document_uploaded", entityType: "Provider", entityId: "../../etc/passwd" })).toBeNull();
    expect(resolveNotificationAction({ eventType: "provider.verification_submitted", entityType: "Provider", entityId: null })).toBeNull();
  });

  it("admin event with the WRONG entityType → null (entityType=Provider alone is required, and never sufficient by itself)", () => {
    expect(resolveNotificationAction({ eventType: "provider.verification_submitted", entityType: "Booking", entityId: UUID })).toBeNull();
    expect(resolveNotificationAction({ eventType: "provider.document_uploaded", entityType: null, entityId: UUID })).toBeNull();
  });

  it("unknown / legacy event → null (renders as plain notification, no CTA)", () => {
    expect(resolveNotificationAction({ eventType: "booking.confirmed", entityType: "Provider", entityId: UUID })).toBeNull();
    expect(resolveNotificationAction({ eventType: null, entityType: "Provider", entityId: UUID })).toBeNull();
    expect(resolveNotificationAction({ eventType: "", entityType: "Provider", entityId: UUID })).toBeNull();
  });

  it("never accepts or returns a caller-supplied / absolute href — resolved hrefs are internal paths only", () => {
    // A would-be attacker-controlled 'entityId' holding a URL cannot become the destination.
    const action = resolveNotificationAction({ eventType: "provider.verification_submitted", entityType: "Provider", entityId: "https://evil.example.com" });
    expect(action).toBeNull();
    // Every resolvable href is a leading-slash internal path, never absolute.
    for (const e of ["provider.verification_submitted", "provider.approved", "provider.changes_requested", "provider.rejected"]) {
      const a = resolveNotificationAction({ eventType: e, entityType: "Provider", entityId: UUID });
      if (a) {
        expect(a.href.startsWith("/")).toBe(true);
        expect(a.href).not.toMatch(/^https?:\/\//);
      }
    }
  });

  it("audience isolation: an ADMIN event never resolves to a provider route, and a PROVIDER event never resolves into /admin", () => {
    for (const e of ["provider.verification_submitted", "provider.changes_resubmitted", "provider.document_uploaded", "provider.document_replaced"]) {
      const a = resolveNotificationAction({ eventType: e, entityType: "Provider", entityId: UUID });
      expect(a?.href.startsWith("/admin/")).toBe(true);
      expect(a?.href.startsWith("/provider")).toBe(false);
    }
    for (const e of ["provider.approved", "provider.changes_requested", "provider.document_rejected", "provider.rejected"]) {
      const a = resolveNotificationAction({ eventType: e, entityType: "Provider", entityId: UUID });
      expect(a?.href.startsWith("/admin")).toBe(false);
    }
  });
});
