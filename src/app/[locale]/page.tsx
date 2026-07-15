import { redirect } from "next/navigation";
import { ShieldCheck, Award, Zap, Headset } from "lucide-react";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/ui/logo";

// Landing/login page — moved here verbatim from src/app/page.tsx
// (BARQ Internationalization Phase A.3 route bridge).
//
// WHY THIS MOVED: middleware.ts's routing uses localePrefix: "always",
// so "/" always redirects to a negotiated locale (e.g. "/ar") before
// any page component runs — the old unprefixed src/app/page.tsx was
// therefore genuinely unreachable, discovered during this phase's own
// browser verification. This file is the smallest correct fix: the
// real homepage now lives at the one place a request for "/" actually
// lands. src/app/page.tsx was deleted, not duplicated — this is the
// only copy of this implementation.
//
// PRESERVED EXACTLY: the server-side session check and
// redirect-to-/dashboard-if-authenticated logic, the full visual
// layout, and every hardcoded string below except LoginForm's own
// (already migrated to next-intl in this same phase). Migrating this
// page's own hero copy (headline/subtitle/feature labels) is explicitly
// out of scope — only LoginForm's strings and this routing move were
// approved.
//
// *** REAL ASSET GAP, STILL FLAGGED *** — no actual Salalah/Oman
// photography exists anywhere in this sandbox, unchanged from the
// prior pass. Stand-in gradient/terrain treatment retained, now using
// the new brand-gradient utility (bg-luxury-gradient) reflecting the
// updated purple/teal palette. Swap for a real photo once available —
// see bg-luxury-gradient's own definition in globals.css.
//
// LOGO COLOR ASSUMPTION, FLAGGED: `brightness-0 invert` assumes the
// logo needs to render white on this dark panel — this is an assumption
// about the logo's own colors, which are unknown here. If the real logo
// has its own brand colors that shouldn't be forced white, remove this
// filter.

const features = [
  { label: "رحلات موثوقة", icon: ShieldCheck },
  { label: "مرشدون معتمدون", icon: Award },
  { label: "حجز سريع", icon: Zap },
  { label: "دعم متواصل", icon: Headset },
];

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    redirect("/dashboard");
  }

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
        {/* Dark gradient overlay for text legibility, per explicit request */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
        />

        <div className="relative z-10 p-12">
          <Logo className="h-16 brightness-0 invert" />
        </div>

        <div className="relative z-10 flex flex-col gap-8 p-12 pb-16">
          <div>
            <h1 className="max-w-lg text-5xl font-semibold leading-[1.15] text-white">
              اكتشف أجمل التجارب السياحية في سلطنة عمان
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">
              احجز رحلتك بسهولة مع أفضل المرشدين ومزودي الخدمات.
            </p>
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
            <Logo className="h-16" />
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
