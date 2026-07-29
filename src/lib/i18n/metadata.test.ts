import { describe, it, expect } from "vitest";
import { buildLocalizedMetadata } from "./metadata";

const ALL_LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

describe("buildLocalizedMetadata", () => {
  it("canonicalizes to the given locale and pathname", () => {
    const metadata = buildLocalizedMetadata({ locale: "en", pathname: "/services/123", title: "t" });
    expect(metadata.alternates?.canonical).toBe("/en/services/123");
  });

  it("includes all 8 locale alternates plus x-default, with no extras", () => {
    const metadata = buildLocalizedMetadata({ locale: "de", pathname: "/services", title: "t" });
    const languages = metadata.alternates?.languages as Record<string, string>;
    const keys = Object.keys(languages);

    expect(keys).toHaveLength(9);
    for (const locale of ALL_LOCALES) {
      expect(languages[locale]).toBe(`/${locale}/services`);
    }
    expect(languages["x-default"]).toBe("/ar/services");
  });

  it("points x-default at Arabic regardless of the requested locale", () => {
    const metadata = buildLocalizedMetadata({ locale: "ru", pathname: "", title: "t" });
    const languages = metadata.alternates?.languages as Record<string, string>;
    expect(languages["x-default"]).toBe("/ar");
  });

  it("sets a matching Open Graph locale for every supported locale", () => {
    const expected: Record<string, string> = {
      ar: "ar_AR",
      en: "en_US",
      de: "de_DE",
      it: "it_IT",
      pl: "pl_PL",
      fr: "fr_FR",
      cs: "cs_CZ",
      ru: "ru_RU",
    };
    for (const locale of ALL_LOCALES) {
      const metadata = buildLocalizedMetadata({ locale, pathname: "/services", title: "t" });
      expect(metadata.openGraph?.locale).toBe(expected[locale]);
    }
  });

  // Growth Foundations phase — additive `images` override.
  it("defaults to the static logo (summary card) when no images override is given", () => {
    const metadata = buildLocalizedMetadata({ locale: "en", pathname: "/about", title: "t" });
    expect(metadata.openGraph?.images).toEqual(["/Barqlogo.png"]);
    expect(metadata.twitter).toMatchObject({ card: "summary", images: ["/Barqlogo.png"] });
  });

  it("uses the caller-supplied images and switches to summary_large_image when provided", () => {
    const metadata = buildLocalizedMetadata({
      locale: "en",
      pathname: "/services/1",
      title: "t",
      images: ["https://example.com/en/services/1/opengraph-image"],
    });
    expect(metadata.openGraph?.images).toEqual(["https://example.com/en/services/1/opengraph-image"]);
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: ["https://example.com/en/services/1/opengraph-image"],
    });
  });
});
