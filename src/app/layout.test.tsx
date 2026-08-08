import { describe, it, expect } from "vitest";
import RootLayout from "./layout";

// i18n stabilization — guard test. The root layout MUST stay a pass-through
// (no <html>/<body>, no NextIntlClientProvider). If any of those move back
// here — above the [locale] segment — they would stop re-rendering on a soft
// locale switch and re-introduce the stale-provider / mixed-language bug.

describe("RootLayout is a locale-agnostic pass-through", () => {
  it("returns its children unchanged", () => {
    const children = { marker: "children" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(RootLayout({ children: children as any })).toBe(children);
  });
});
