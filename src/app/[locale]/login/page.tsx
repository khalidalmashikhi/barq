import { ShieldCheck, Award, Zap, Headset } from "lucide-react";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession, isActiveAdminSession } from "@/lib/auth";
import { isGoogleConfigured } from "@/lib/auth/social-config";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/ui/logo";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";

// Login page — Phase F.1 (UI/UX Redesign Foundation).
//
// RELOCATED from src/app/[locale]/page.tsx, which combined this hero+
// OTP experience with the site's ONLY entry point — meaning every
// unauthenticated visitor was dropped straight into a login form, with
// no way to browse or feel "inspired to explore destinations before
// performing any action" (this phase's own Product Vision). "/" is now
// a real public marketing landing page (see page.tsx); this dedicated
// /login route is where its "Sign In" calls to action actually lead.
//
// PRESERVED EXACTLY: the split-hero layout, the glass auth card, the
// full LoginForm component (OTP state machine untouched — Auth/OTP
// architecture is explicitly off-limits this phase), the
// redirect-to-/dashboard-if-already-authenticated logic.
//
// NEWLY INTERNATIONALIZED: the hero headline/subtitle/feature labels
// were hardcoded Arabic-only in the prior version (explicitly flagged
// there as "out of scope" for that migration) — now real "auth"
// namespace keys (heroTitle/heroSubtitle/featureTrustedTrips/etc.),
// consistent with every other string on this page and this project's
// 8-language target (ADR-0010).
//
// *** REAL ASSET GAP, STILL FLAGGED *** — no actual Salalah/Oman
// photography exists anywhere in this sandbox. Stand-in gradient/
// terrain treatment retained (bg-luxury-gradient). Swap for a real
// photo once available.

export async function generateMetadata(): Promise<Metadata> {
  const tAuth = await getServerTranslator("auth");
  const tSeo = await getServerTranslator("seo");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/login",
    title: tAuth("loginTitle"),
    description: tSeo("loginDescription"),
  });
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();

  if (session) {
    const locale = await getLocale();
    // Role-aware post-login landing (Gate A): an ACTIVE Admin is backoffice-only,
    // so an already-authenticated admin lands in /admin, never the customer
    // dashboard. Every other authenticated user keeps the existing /dashboard
    // landing (Google OAuth callbackURL=/dashboard is covered too, because
    // /dashboard itself redirects active admins onward).
    redirect({ href: (await isActiveAdminSession()) ? "/admin" : "/dashboard", locale });
  }

  // Better Auth redirects here with `?error=...` if a Google OAuth attempt fails
  // (user cancelled, provider error, etc.) — we surface a single generic,
  // localized message and never render the raw provider/Better Auth error.
  const { error } = await searchParams;
  const oauthError = Boolean(error);

  const t = await getServerTranslator("auth");

  const features = [
    { label: t("featureTrustedTrips"), icon: ShieldCheck },
    { label: t("featureCertifiedGuides"), icon: Award },
    { label: t("featureFastBooking"), icon: Zap },
    { label: t("featureSupport"), icon: Headset },
  ];

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/* LEFT: full-height hero */}
      <div className="relative hidden overflow-hidden bg-luxury-gradient lg:flex lg:flex-col lg:justify-between">
        {/* Stand-in for real Salalah photography — see note above. */}
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full opacity-[0.1]"
          viewBox="0 0 400 800"
          preserveAspectRatio="xMidYMax slice"
        >
          <path d="M0 650 L80 550 L160 620 L240 480 L320 580 L400 500 L400 800 L0 800 Z" fill="#000" opacity="0.3" />
          <path d="M0 700 L100 600 L200 680 L280 560 L400 640 L400 800 L0 800 Z" fill="#000" opacity="0.4" />
        </svg>
        {/* Dark gradient overlay for text legibility */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        <div className="relative z-10 p-12">
          <Logo variant="mark" className="h-16 brightness-0 invert" />
        </div>

        <div className="relative z-10 flex flex-col gap-8 p-12 pb-16">
          <div>
            <h1 className="max-w-lg text-5xl font-semibold leading-[1.15] text-white">{t("heroTitle")}</h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">{t("heroSubtitle")}</p>
          </div>

          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <li key={feature.label} className="flex items-center gap-2 text-sm text-white/80">
                  <Icon size={16} strokeWidth={2} className="text-accent" />
                  {feature.label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* RIGHT: premium glass auth card */}
      <div className="relative flex flex-col items-center justify-center overflow-hidden bg-background px-6 py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -start-24 bottom-0 h-72 w-72 rounded-full bg-secondary/10 blur-3xl"
        />
        <div className="relative z-10 w-full max-w-sm">
          <div className="mb-10 flex justify-center lg:hidden">
            <Logo variant="full" className="h-24" />
          </div>
          <LoginForm googleEnabled={isGoogleConfigured()} oauthError={oauthError} />
        </div>
      </div>
    </main>
  );
}
