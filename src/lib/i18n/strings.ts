// Minimal centralized strings — Engineering Sprint 3 (Phone OTP UI).
//
// IMPORTANT SCOPE NOTE: this is a deliberately minimal stopgap, not a new
// architectural decision. ADR-0005 (Bilingual by Design) requirement 8
// prohibits hardcoded user-facing text anywhere in the application — this
// module exists so this sprint's UI complies with that rule without
// inventing a full i18n library choice, which no approved document has
// made (TECH_STACK.md does not name one). A real i18n library (e.g.
// next-intl or similar) remains an open implementation decision for a
// future sprint — do not treat this file as the final i18n architecture.
//
// LOCALIZATION.md §3's resolved negotiation priority (stored preference →
// request-level negotiation → Arabic default) is not implemented here —
// no user account exists before login, and request-level negotiation UI
// is out of this sprint's scope. Every string below defaults to Arabic,
// consistent with that same fallback chain's final step. English
// equivalents are included for the future language switcher, not yet
// wired to one.

export const strings = {
  ar: {
    appName: "برق",
    loginTitle: "تسجيل الدخول",
    loginSubtitle: "احجز تجارب سياحية موثوقة في عُمان",
    phoneLabel: "رقم الهاتف",
    phonePlaceholder: "+968 9XXX XXXX",
    requestOtpButton: "إرسال رمز التحقق",
    otpLabel: "رمز التحقق",
    otpPlaceholder: "أدخل الرمز المرسل إليك",
    verifyOtpButton: "تأكيد",
    changePhoneButton: "تغيير رقم الهاتف",
    loading: "جارٍ التحميل...",
    otpSentSuccess: "تم إرسال رمز التحقق",
    genericError: "حدث خطأ ما، الرجاء المحاولة مرة أخرى",
    dashboardTitle: "لوحة التحكم",
    dashboardWelcome: "تم تسجيل الدخول بنجاح",
    logoutButton: "تسجيل الخروج",
  },
  en: {
    appName: "BARQ",
    loginTitle: "Sign In",
    loginSubtitle: "Book trustworthy tourism experiences in Oman",
    phoneLabel: "Phone Number",
    phonePlaceholder: "+968 9XXX XXXX",
    requestOtpButton: "Send Verification Code",
    otpLabel: "Verification Code",
    otpPlaceholder: "Enter the code sent to you",
    verifyOtpButton: "Verify",
    changePhoneButton: "Change Phone Number",
    loading: "Loading...",
    otpSentSuccess: "Verification code sent",
    genericError: "Something went wrong, please try again",
    dashboardTitle: "Dashboard",
    dashboardWelcome: "Signed in successfully",
    logoutButton: "Log Out",
  },
} as const;

// Arabic default, per PROJECT_MANIFEST.md Core Value 4 and ADR-0005 — no
// language switcher exists yet in this sprint's scope.
export const t = strings.ar;
