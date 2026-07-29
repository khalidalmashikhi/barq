import { describe, it, expect, vi } from "vitest";
import enAdmin from "../../../../messages/en/admin.json";
import arAdmin from "../../../../messages/ar/admin.json";
import deAdmin from "../../../../messages/de/admin.json";
import { getServiceStatusBadgeVariant, getServiceStatusTranslationKey } from "./service-status";

// Service Status Localization & Presentation Consolidation — regression
// tests. This module must NEVER return translated text itself (that was
// the original bug: hardcoded Arabic label text rendered regardless of
// locale) — it only returns a locale-independent Badge variant and a
// translation key, resolved against the real messages/*/admin.json
// files here to prove the actual, shipped translations are correct and
// distinct per locale.

vi.mock("server-only", () => ({}));

const STATUSES = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"] as const;

describe("getServiceStatusTranslationKey", () => {
  it("returns a stable, distinct key for each of the 4 real statuses", () => {
    expect(getServiceStatusTranslationKey("DRAFT")).toBe("serviceStatusDraft");
    expect(getServiceStatusTranslationKey("PUBLISHED")).toBe("serviceStatusPublished");
    expect(getServiceStatusTranslationKey("PAUSED")).toBe("serviceStatusPaused");
    expect(getServiceStatusTranslationKey("ARCHIVED")).toBe("serviceStatusArchived");
  });

  it("resolves to the correct real English label for every status", () => {
    const messages = enAdmin as Record<string, string>;
    expect(messages[getServiceStatusTranslationKey("DRAFT")]).toBe("Draft");
    expect(messages[getServiceStatusTranslationKey("PUBLISHED")]).toBe("Published");
    expect(messages[getServiceStatusTranslationKey("PAUSED")]).toBe("Paused");
    expect(messages[getServiceStatusTranslationKey("ARCHIVED")]).toBe("Archived");
  });

  it("resolves to the correct real Arabic label for every status", () => {
    const messages = arAdmin as Record<string, string>;
    expect(messages[getServiceStatusTranslationKey("DRAFT")]).toBe("مسودة");
    expect(messages[getServiceStatusTranslationKey("PUBLISHED")]).toBe("منشورة");
    expect(messages[getServiceStatusTranslationKey("PAUSED")]).toBe("متوقفة مؤقتاً");
    expect(messages[getServiceStatusTranslationKey("ARCHIVED")]).toBe("مؤرشفة");
  });

  it("resolves to the correct real German label for every status (a third, non-Arabic/English locale)", () => {
    const messages = deAdmin as Record<string, string>;
    expect(messages[getServiceStatusTranslationKey("DRAFT")]).toBe("Entwurf");
    expect(messages[getServiceStatusTranslationKey("PUBLISHED")]).toBe("Veröffentlicht");
    expect(messages[getServiceStatusTranslationKey("PAUSED")]).toBe("Pausiert");
    expect(messages[getServiceStatusTranslationKey("ARCHIVED")]).toBe("Archiviert");
  });

  it("never resolves the English locale to the Arabic label — the original confirmed bug", () => {
    const messages = enAdmin as Record<string, string>;
    for (const status of STATUSES) {
      expect(messages[getServiceStatusTranslationKey(status)]).not.toBe("منشورة");
    }
  });

  it("never falls back to the English label when resolving Arabic or German for the same status", () => {
    const enMessages = enAdmin as Record<string, string>;
    const arMessages = arAdmin as Record<string, string>;
    const deMessages = deAdmin as Record<string, string>;
    for (const status of STATUSES) {
      const key = getServiceStatusTranslationKey(status);
      expect(arMessages[key]).not.toBe(enMessages[key]);
      expect(deMessages[key]).not.toBe(enMessages[key]);
    }
  });

  it("falls back safely to the DRAFT key for an unknown status value, never a raw enum passthrough", () => {
    expect(getServiceStatusTranslationKey("SOME_UNEXPECTED_VALUE")).toBe("serviceStatusDraft");
    expect(getServiceStatusTranslationKey("")).toBe("serviceStatusDraft");
  });
});

describe("getServiceStatusBadgeVariant", () => {
  it("returns the existing, unchanged Badge variant for each status", () => {
    expect(getServiceStatusBadgeVariant("DRAFT")).toBe("default");
    expect(getServiceStatusBadgeVariant("PUBLISHED")).toBe("success");
    expect(getServiceStatusBadgeVariant("PAUSED")).toBe("warning");
    expect(getServiceStatusBadgeVariant("ARCHIVED")).toBe("danger");
  });

  it("falls back safely to the DRAFT variant for an unknown status value", () => {
    expect(getServiceStatusBadgeVariant("SOME_UNEXPECTED_VALUE")).toBe("default");
    expect(getServiceStatusBadgeVariant("")).toBe("default");
  });
});
