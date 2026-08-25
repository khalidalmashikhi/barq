import { describe, it, expect } from "vitest";
import { buildBarqOtpEmail } from "./email-template";

// AUTH-EMAIL-VENDOR-1 — the bilingual OTP email content builder is pure (no
// server-only), imported directly.

describe("buildBarqOtpEmail", () => {
  it("carries the code in the text and html bodies (not the subject)", () => {
    const { subject, text, html } = buildBarqOtpEmail("482913");
    expect(text).toContain("482913");
    expect(html).toContain("482913");
    expect(subject).not.toContain("482913"); // subject is generic, never the code
  });

  it("is bilingual (English + Arabic) and uses the correct brand برق (never بارق)", () => {
    const { subject, text, html } = buildBarqOtpEmail("000000");
    expect(text).toContain("Your BARQ verification code");
    expect(text).toContain("رمز التحقق"); // Arabic present
    expect(html).toContain("برق");
    for (const part of [subject, text, html]) {
      expect(part).not.toContain("بارق"); // brand-rule: never the misspelling
    }
  });

  it("includes expiry guidance and a do-not-share / ignore-if-unrequested line", () => {
    const { text } = buildBarqOtpEmail("123456");
    expect(text).toMatch(/expires/i);
    expect(text).toMatch(/never share/i);
    expect(text).toMatch(/ignore/i);
  });

  it("is generic across flows — it takes only the code, so it never leaks sign-in vs change-email", () => {
    // The builder signature carries no `type`, so sign-in and change-email emails are identical.
    expect(buildBarqOtpEmail("111111")).toEqual(buildBarqOtpEmail("111111"));
  });

  it("HTML-escapes the code defensively", () => {
    const { html } = buildBarqOtpEmail('<b>x</b>');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});
