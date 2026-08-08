import { describe, it, expect, vi } from "vitest";

// i18n stabilization — regression tests for the language contract's ROOT
// CAUSE fix. These assert that the [locale] layout derives <html lang>, the
// document `dir`, and the NextIntlClientProvider's locale ENTIRELY from the
// URL `locale` param (the single source of truth) — so a locale switch, which
// re-renders this segment, updates server text, client messages, lang, and
// dir together. (The bug was these living in the root layout above [locale],
// which does not re-render on a soft locale switch → stale/mixed UI.)

vi.mock("../fonts", () => ({
  plexArabic: { variable: "font-ar" },
  plexLatin: { variable: "font-lat" },
}));
vi.mock("../globals.css", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next-intl", () => ({
  hasLocale: (locales: readonly string[], value: string) => locales.includes(value),
  NextIntlClientProvider: (props: { children?: unknown }) => props.children,
}));

vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("framer-motion", () => ({ MotionConfig: (props: { children?: unknown }) => props.children }));
vi.mock("@/components/ui/skip-link", () => ({ SkipLink: () => null }));
vi.mock("@/components/ui/offline-banner", () => ({ OfflineBanner: () => null }));
vi.mock("@/lib/seo/safe-json-ld", () => ({ toSafeJsonLdString: () => "{}" }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: vi.fn() }));

const { NextIntlClientProvider } = await import("next-intl");
const { default: LocaleLayout } = await import("./layout");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findProvider(htmlEl: any) {
  const body = htmlEl.props.children;
  const kids = Array.isArray(body.props.children) ? body.props.children : [body.props.children];
  return kids.find((k: { type?: unknown }) => k && k.type === NextIntlClientProvider);
}

describe("LocaleLayout — URL locale is the single source of truth", () => {
  it.each([
    ["ar", "rtl"],
    ["en", "ltr"],
    ["de", "ltr"],
    ["ru", "ltr"],
  ])("locale=%s → <html lang=%s dir=%s> and provider locale matches", async (locale, dir) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el: any = await LocaleLayout({ children: "content", params: Promise.resolve({ locale }) });

    expect(el.type).toBe("html");
    expect(el.props.lang).toBe(locale);
    expect(el.props.dir).toBe(dir);

    const provider = findProvider(el);
    expect(provider).toBeDefined();
    expect(provider.props.locale).toBe(locale);
  });

  it("Arabic is RTL and English is LTR (direction is not hardcoded)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ar: any = await LocaleLayout({ children: "x", params: Promise.resolve({ locale: "ar" }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const en: any = await LocaleLayout({ children: "x", params: Promise.resolve({ locale: "en" }) });
    expect(ar.props.dir).toBe("rtl");
    expect(en.props.dir).toBe("ltr");
    expect(ar.props.lang).not.toBe(en.props.lang);
  });

  it("an invalid locale segment triggers notFound() (no silent default render)", async () => {
    await expect(LocaleLayout({ children: "x", params: Promise.resolve({ locale: "xx" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
  });
});
