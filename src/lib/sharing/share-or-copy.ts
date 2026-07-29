// Pure share/clipboard-fallback decision logic — Growth Foundations
// phase, extracted out of ShareButton (src/components/ui/share-button.tsx)
// specifically so it can be unit-tested without a DOM/React renderer
// (this codebase has no jsdom/@testing-library/react dependency —
// Client Component tests elsewhere inspect returned element trees
// directly, which doesn't work for a component with hooks; this module
// is the same "extract the pure logic" pattern already used by
// src/lib/booking/booking-status.ts and src/lib/payments/payment-status.ts
// for the same reason).
//
// Every dependency (share/clipboardWrite/hasShare) is injected so tests
// never need a real navigator.share/navigator.clipboard.

export type ShareOrCopyResult = "shared" | "copied" | "cancelled" | "error";

export type ShareOrCopyInput = {
  url: string;
  title: string;
  text?: string;
  hasShare: boolean;
  share: (data: { title: string; text?: string; url: string }) => Promise<void>;
  clipboardWrite: (text: string) => Promise<void>;
};

export async function shareOrCopy({ url, title, text, hasShare, share, clipboardWrite }: ShareOrCopyInput): Promise<ShareOrCopyResult> {
  if (hasShare) {
    try {
      await share({ title, text, url });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return "cancelled";
      }
      // Falls through to the clipboard fallback below for any other
      // navigator.share failure (e.g. not a secure context).
    }
  }

  try {
    await clipboardWrite(url);
    return "copied";
  } catch {
    return "error";
  }
}
