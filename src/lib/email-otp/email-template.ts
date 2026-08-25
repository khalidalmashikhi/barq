// BARQ email OTP message content — AUTH-EMAIL-VENDOR-1.
//
// Pure builder (no I/O, no secrets) so it is unit-testable and reusable across
// email vendors. Bilingual English + Arabic in ONE message: Better Auth's
// emailOTP `sendVerificationOTP` callback carries no locale, and BARQ's audience
// is Oman-first, so a single bilingual email is more robust than guessing a
// language. The 6-digit code itself is language-neutral.
//
// Deliberately generic for both `type: "sign-in"` and `type: "change-email"` — the
// same "here is your verification code" message serves customer sign-in and the
// authenticated "add email" ownership proof, so no flow leaks which action it is.
//
// The brand is "برق" (never "بارق") per the project brand rule. Contains ONLY the
// code + expiry guidance + a safety line — never an internal id, name, or any PII.

export interface OtpEmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the bilingual BARQ verification-code email for a given OTP. */
export function buildBarqOtpEmail(code: string): OtpEmailContent {
  const safeCode = escapeHtml(code);

  const subject = "Your BARQ verification code — رمز التحقق من برق";

  const text = [
    `Your BARQ verification code is: ${code}`,
    "It expires in about 5 minutes. Never share this code with anyone.",
    "If you didn't request this, you can safely ignore this email.",
    "",
    `رمز التحقق الخاص بك من برق هو: ${code}`,
    "تنتهي صلاحيته خلال 5 دقائق تقريبًا. لا تشارك هذا الرمز مع أي شخص.",
    "إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.",
  ].join("\n");

  const html = `<!-- BARQ verification code (bilingual) -->
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <div style="text-align:center;font-size:20px;font-weight:700;letter-spacing:.02em;margin-bottom:8px;">BARQ · برق</div>
  <div style="text-align:center;font-size:32px;font-weight:700;letter-spacing:.35em;padding:16px 0;margin:8px 0;border:1px solid #e5e5e5;border-radius:12px;">${safeCode}</div>
  <p style="font-size:14px;line-height:1.5;">Your BARQ verification code is above. It expires in about 5&nbsp;minutes. Never share this code with anyone. If you didn't request this, you can safely ignore this email.</p>
  <p dir="rtl" style="font-size:14px;line-height:1.7;text-align:right;">رمز التحقق الخاص بك من برق مذكور أعلاه. تنتهي صلاحيته خلال 5 دقائق تقريبًا. لا تشارك هذا الرمز مع أي شخص. إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.</p>
</div>`;

  return { subject, text, html };
}
