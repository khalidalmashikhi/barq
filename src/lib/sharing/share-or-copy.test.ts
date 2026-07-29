import { describe, it, expect, vi } from "vitest";
import { shareOrCopy } from "./share-or-copy";

// Growth Foundations phase — regression tests for the pure share/
// clipboard-fallback decision logic behind ShareButton. Every
// dependency is injected, so these run with no DOM/React renderer.

describe("shareOrCopy", () => {
  it("uses navigator.share when available and reports 'shared' on success", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const clipboardWrite = vi.fn();

    const result = await shareOrCopy({
      url: "https://example.com/en/services/1",
      title: "Desert Tour",
      hasShare: true,
      share,
      clipboardWrite,
    });

    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Desert Tour", text: undefined, url: "https://example.com/en/services/1" });
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("reports 'cancelled' (not an error, no clipboard fallback) when the user dismisses the native share sheet", async () => {
    const abortError = new DOMException("The user aborted a request", "AbortError");
    const share = vi.fn().mockRejectedValue(abortError);
    const clipboardWrite = vi.fn();

    const result = await shareOrCopy({
      url: "https://example.com/en/services/1",
      title: "Desert Tour",
      hasShare: true,
      share,
      clipboardWrite,
    });

    expect(result).toBe("cancelled");
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("falls back to clipboard when navigator.share rejects for a reason other than cancellation", async () => {
    const share = vi.fn().mockRejectedValue(new Error("not a secure context"));
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);

    const result = await shareOrCopy({
      url: "https://example.com/en/services/1",
      title: "Desert Tour",
      hasShare: true,
      share,
      clipboardWrite,
    });

    expect(result).toBe("copied");
    expect(clipboardWrite).toHaveBeenCalledWith("https://example.com/en/services/1");
  });

  it("goes straight to clipboard when the Web Share API is unavailable", async () => {
    const share = vi.fn();
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);

    const result = await shareOrCopy({
      url: "https://example.com/en/providers/1",
      title: "Desert Co",
      hasShare: false,
      share,
      clipboardWrite,
    });

    expect(result).toBe("copied");
    expect(share).not.toHaveBeenCalled();
  });

  it("reports 'error' when both share is unavailable and the clipboard write fails", async () => {
    const share = vi.fn();
    const clipboardWrite = vi.fn().mockRejectedValue(new Error("clipboard denied"));

    const result = await shareOrCopy({
      url: "https://example.com/en/providers/1",
      title: "Desert Co",
      hasShare: false,
      share,
      clipboardWrite,
    });

    expect(result).toBe("error");
  });
});
