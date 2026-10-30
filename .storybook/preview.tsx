/// <reference types="vite/client" />
import { useEffect, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { plexArabic, plexLatin } from "../src/app/fonts";
import "../src/app/globals.css";
import "../design-lab/lab.css";

// Real BARQ messages (the same files the app loads, merged by namespace as src/i18n/request.ts does).
const files = import.meta.glob<{ default: Record<string, unknown> }>("../messages/{ar,en}/*.json", { eager: true });
const messagesFor = (locale: "ar" | "en") =>
  Object.fromEntries(
    Object.entries(files)
      .filter(([p]) => p.includes(`/messages/${locale}/`))
      .map(([p, m]) => [p.split("/").pop()!.replace(".json", ""), m.default]),
  );
const MESSAGES = { ar: messagesFor("ar"), en: messagesFor("en") };

type Locale = keyof typeof MESSAGES;

/** Sets <html lang/dir> and the root text size (the type scale is rem-based, so 150 % / 200 % scale it all). */
function DocumentFrame({ locale, textScale, children }: { locale: Locale; textScale: string; children: ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === "ar" ? "rtl" : "ltr";
    html.style.fontSize = textScale === "100" ? "" : `${textScale}%`;
    html.classList.add(plexArabic.variable, plexLatin.variable);
    document.body.classList.add("font-sans");
  }, [locale, textScale]);
  return <>{children}</>;
}

const withBarqDocument: Decorator = (Story, context) => {
  const locale = (context.globals.locale ?? "ar") as Locale;
  const textScale = String(context.globals.textScale ?? "100");
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Muscat">
      <DocumentFrame locale={locale} textScale={textScale}>
        <div dir={locale === "ar" ? "rtl" : "ltr"} className={`${plexArabic.variable} ${plexLatin.variable} font-sans text-foreground`}>
          <Story />
        </div>
      </DocumentFrame>
    </NextIntlClientProvider>
  );
};

const preview: Preview = {
  decorators: [withBarqDocument],
  globalTypes: {
    locale: {
      description: "Interface language",
      toolbar: { title: "Language", icon: "globe", items: [{ value: "ar", title: "العربية (RTL)" }, { value: "en", title: "English (LTR)" }], dynamicTitle: true },
    },
    textScale: {
      description: "Root text size",
      toolbar: { title: "Text size", icon: "zoom", items: [{ value: "100", title: "100 %" }, { value: "150", title: "150 %" }, { value: "200", title: "200 %" }], dynamicTitle: true },
    },
  },
  initialGlobals: { locale: "ar", textScale: "100", viewport: { value: "phone375", isRotated: false } },
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
    controls: { expanded: true },
    a11y: { test: "error" },
    viewport: {
      options: {
        phone375: { name: "iPhone 375 × 812", styles: { width: "375px", height: "812px" }, type: "mobile" },
        phone430: { name: "iPhone 430 × 932", styles: { width: "430px", height: "932px" }, type: "mobile" },
        desktop1440: { name: "Desktop 1440 × 900", styles: { width: "1440px", height: "900px" }, type: "desktop" },
      },
    },
    options: { storySort: { order: ["Foundations", "Components", "Prototypes", "Current app (before)"] } },
  },
};

export default preview;
